/// One drift-correcting action `DomainConfigReconciler` can apply. Produced only for findings
/// `DomainConfigAudit` classified as unambiguous app-owned drift (#1171) — never for
/// `.ownerQuestion`/`.informational` findings, which the reconcile plan never includes.
public enum DomainConfigReconcileItem: Sendable, Equatable, CustomStringConvertible {
    /// Create a declared managed DNS record that has no live counterpart at all.
    case createManagedRecord(DomainConfig.DNSRecord)
    /// Delete the stale live record (by Cloudflare record id) and recreate it with the declared
    /// content — Cloudflare's write API has no update-in-place, so a content drift is a
    /// delete-then-recreate rather than a patch.
    case replaceManagedRecord(staleRecordID: String, declared: DomainConfig.DNSRecord)
    /// Reapply one declared edge-hardening setting via the same vocabulary `HardenExecutor`
    /// already knows how to apply.
    case hardenEdge(HardenPlanItem)

    /// One diff-style `+`-prefixed preview line, matching `HardenPlanItem.description`'s idiom —
    /// `DomainConfigReconcilePlan.summary` joins these into the opt-in preview the owner approves.
    public var description: String {
        switch self {
        case .createManagedRecord(let record):
            return "+ Create \(record.type) record \(record.name): \(record.content)"
        case .replaceManagedRecord(_, let declared):
            return "+ Replace \(declared.type) record \(declared.name) with: \(declared.content)"
        case .hardenEdge(let item):
            return item.description
        }
    }
}

/// A computed set of drift-correcting changes, ready for preview and opt-in application —
/// the `DomainConfigAudit` counterpart to `HardenPlan` (investigation doc §5.5: "remediation
/// reuses the Harden idiom").
public struct DomainConfigReconcilePlan: Sendable, Equatable {
    /// The changes to apply, in emission order — also the order `summary` previews them and
    /// `DomainConfigReconciler` applies them.
    public let items: [DomainConfigReconcileItem]
    /// True when there is no unambiguous app-owned drift to correct.
    public var isEmpty: Bool { items.isEmpty }

    /// Creates a plan. Normally produced via `DomainConfigAudit.evaluate(...).reconcilePlan`;
    /// direct construction is for tests.
    public init(items: [DomainConfigReconcileItem]) {
        self.items = items
    }

    /// Human-readable preview shown before the owner opts in.
    public var summary: String {
        if items.isEmpty { return "No drift to reconcile." }
        return items.map(\.description).joined(separator: "\n")
    }
}
