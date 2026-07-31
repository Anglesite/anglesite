// Sources/AnglesiteCore/IntegrationWizardModel.swift
import Foundation
import Observation

/// Observable state machine behind the integration-wizard sheet — the UI driver of the
/// bucket-3 framework.
///
/// One instance lives for the whole wizard session (per open sheet, not per attempt), so all
/// cross-step state — `answers`, the computed plan, apply progress — lives here rather than in
/// per-step views. Planning and applying are delegated to the injected
/// ``IntegrationOperationsService``, so the model never touches the filesystem itself and can
/// be exercised entirely by unit tests.
@MainActor @Observable
public final class IntegrationWizardModel: Identifiable {
    /// The wizard's pages in forward order; the `Int` raw values drive `advance()`/`back()`
    /// arithmetic, so the declaration order *is* the navigation order.
    public enum Step: Int, CaseIterable {
        /// Choose which integration to set up.
        case pickIntegration
        /// Choose a provider — skipped entirely for provider-less descriptors (e.g. giscus).
        case pickProvider
        /// Fill in the descriptor's currently-visible fields.
        case fields
        /// Show the computed plan (or the planning error) for confirmation.
        case review
        /// The plan is being applied; forward navigation is disabled from here.
        case applying
    }

    /// Stable identity for SwiftUI presentation (`Identifiable`); fresh per wizard session.
    public let id = UUID()
    /// The page currently shown. Prefer `advance()`/`back()`/`startFromRouter(_:)` over setting
    /// this directly — they implement the provider-step skip rules a raw assignment bypasses.
    public var step: Step = .pickIntegration
    /// The integration chosen on the picker step; nil until the owner picks one.
    public var selectedID: IntegrationID?
    /// Field answers keyed by field key, with the chosen provider under `"provider"` — the
    /// ``Answers`` convention shared with ``IntegrationPlanner``.
    public var answers: Answers = [:]
    /// The plan computed on entering `.review`; nil while planning is in flight or after a
    /// failure. Settable only in-module so views can't publish a plan the service didn't produce.
    public internal(set) var plan: OperationPlan?
    /// Owner-facing message when planning failed — already phrased by the
    /// ``SetupIntegrationArguments`` reply builder, so views show it verbatim.
    public internal(set) var planError: String?
    /// Terminal scaffolder events appended by `apply()`; views read the last element to render
    /// the outcome.
    public internal(set) var progress: [IntegrationScaffolder.SetupStep] = []

    private let service: any IntegrationOperationsService
    private let siteID: String

    /// Creates a wizard model bound to one site.
    ///
    /// - Parameters:
    ///   - service: Backend used for the descriptor catalog, planning, and applying — the seam
    ///     tests stub.
    ///   - siteID: The site every service call targets; fixed for the wizard's lifetime.
    public init(service: any IntegrationOperationsService, siteID: String) {
        self.service = service
        self.siteID = siteID
    }

    /// The descriptor for `selectedID`, resolved against the service's catalog; nil before an
    /// integration is picked.
    public var descriptor: IntegrationDescriptor? {
        guard let id = selectedID else { return nil }
        return service.descriptors().first { $0.id == id }
    }

    /// The catalog entries the picker step offers, in the service's order.
    public var descriptorsForPicker: [IntegrationDescriptor] { service.descriptors() }

    /// The descriptor's fields filtered by their `visibleWhen` conditions against the current
    /// answers — the same visibility rule ``IntegrationPlanner`` applies, so the wizard never
    /// asks for a field the resulting plan would ignore.
    public var visibleFields: [Field] {
        guard let descriptor else { return [] }
        let provider = answers["provider"]
        return descriptor.fields.filter { IntegrationPlanner.isVisible($0.visibleWhen, answers: answers, providerID: provider) }
    }

    /// Whether the current step's forward control should be enabled. `.applying` is always
    /// false: once application starts the wizard has no forward navigation, only the terminal
    /// progress display.
    public var canContinue: Bool {
        switch step {
        case .pickIntegration: return selectedID != nil
        case .pickProvider: return answers["provider"] != nil
        case .fields:
            return visibleFields.allSatisfy { $0.isOptional || !($0.value(in: answers)).isEmpty }
        case .review: return plan != nil
        case .applying: return false
        }
    }

    /// Moves to the next step, skipping `.pickProvider` for provider-less integrations
    /// (e.g. giscus), and (re)computes the plan on entering `.review`.
    ///
    /// Any stale plan is cleared synchronously *before* the async planning call, so the UI
    /// never shows a previous attempt's result while a new one is in flight.
    public func advance() async {
        if step == .pickIntegration, descriptor?.providers.isEmpty == true {
            step = .fields; return
        }
        guard let next = Step(rawValue: step.rawValue + 1) else { return }
        step = next
        if step == .review, let id = selectedID {
            plan = nil
            planError = nil
            let result = await service.plan(integrationID: id, answers: answers, siteID: siteID)
            switch result {
            case .success(let p):
                plan = p
                planError = nil
            case .failure(let error):
                plan = nil
                let descriptor = service.descriptors().first { $0.id == id }
                    ?? IntegrationCatalog.descriptor(for: id)
                planError = SetupIntegrationArguments.reply(for: .failure(error), descriptor: descriptor)
            }
        }
    }

    /// Moves to the previous step, mirroring `advance()`'s forward-skip: a provider-less
    /// integration (e.g. giscus) never shows the provider step, so backing out of `.fields`
    /// must hop straight to `.pickIntegration` rather than strand the user on an empty
    /// `.pickProvider` screen (where `canContinue` would be false).
    public func back() {
        guard let prev = Step(rawValue: step.rawValue - 1) else { return }
        if prev == .pickProvider, descriptor?.providers.isEmpty == true {
            step = .pickIntegration
            return
        }
        step = prev
    }

    /// Entry point for the "Add a Store" router: jumps straight to `.fields` (or `.pickProvider`
    /// if the router didn't resolve a provider, e.g. `.donations`) instead of going through
    /// `.pickIntegration`/`.pickProvider` in order — the router already answered those questions.
    ///
    /// Resets `answers` first: this model persists for the whole wizard session (one instance per
    /// open sheet, not per attempt), so a second "Add a Store" attempt after backing out of a first
    /// would otherwise carry over stale field values — e.g. `buyButton` and `lemonSqueezy` share the
    /// `checkoutUrl`/`buttonText` field keys, so switching categories could pre-fill the wrong
    /// platform's data, and a stale `answers["provider"]` could satisfy `.pickProvider`'s
    /// `canContinue` without the user ever choosing a provider for the new integration.
    public func startFromRouter(_ route: AddStoreRouter.Route) {
        answers = [:]
        selectedID = route.integrationID
        if let provider = route.presetProvider {
            answers["provider"] = provider
        }
        step = (descriptor?.providers.isEmpty == true || route.presetProvider != nil) ? .fields : .pickProvider
    }

    /// Applies the reviewed plan via the service and records the terminal
    /// ``IntegrationScaffolder/SetupStep`` in `progress`. Enters `.applying` first so
    /// navigation locks; no-op when there is no plan to apply.
    public func apply() async {
        guard let plan else { return }
        step = .applying
        let terminal = await service.apply(plan, siteID: siteID)
        progress.append(terminal)
    }
}

private extension Field {
    func value(in answers: Answers) -> String { answers[key] ?? defaultValue ?? "" }
}
