import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

/// Deterministic A/B experiment statistics — the Bucket 6 simplification of the retired
/// `experiment` Claude skill (#466, spec §5/§8).
///
/// The old skill wrapped these numbers in open-ended hypothesis chat; per the Claude Code
/// removal roadmap the journey reduces to a deterministic core: Bayesian significance,
/// lift, sample-ratio-mismatch detection, and a templated suggestion playbook. No LLM is
/// involved anywhere in this file.
///
/// The math is a Swift port of the plugin template's `ab-stats.ts`, with one deliberate
/// upgrade: instead of Monte Carlo simulation, `probabilityTreatmentBeatsControl` uses the
/// exact closed form for Beta-Binomial posteriors (Evan Miller's formula), so results are
/// reproducible bit-for-bit across runs and platforms.
public enum ExperimentStats {
    // MARK: - Inputs / outputs

    /// Conversion counts for a single variant.
    public struct Variant: Sendable, Equatable {
        public let name: String
        public let impressions: Int
        public let conversions: Int

        public init(name: String, impressions: Int, conversions: Int) {
            self.name = name
            self.impressions = max(0, impressions)
            self.conversions = max(0, min(conversions, max(0, impressions)))
        }

        /// Posterior mean conversion rate under a uniform Beta(1,1) prior.
        public var posteriorRate: Double {
            Double(conversions + 1) / Double(impressions + 2)
        }
    }

    /// Outcome of comparing a treatment against the control.
    public struct Result: Sendable, Equatable {
        public enum Winner: Sendable, Equatable {
            case treatment(name: String)
            case control(name: String)
            case inconclusive
        }

        public let winner: Winner
        /// P(treatment rate > control rate) under Beta(1,1) priors. Exact, not simulated.
        public let probabilityTreatmentBeatsControl: Double
        /// Relative lift of the treatment over the control, in percent (posterior means).
        public let liftPercent: Double
        public let controlRate: Double
        public let treatmentRate: Double
    }

    /// Default confidence threshold for declaring a winner (mirrors the retired skill).
    public static let defaultConfidenceThreshold = 0.95

    /// Data-sufficiency floor before an inconclusive test is worth calling (retired skill's
    /// "30+ days, or 500+ impressions per variant" rule — the impression half lives here).
    public static let minimumImpressionsPerVariant = 500

    // MARK: - Analysis

    /// Compare `treatment` against `control` under a Beta-Binomial model with uniform priors.
    ///
    /// - Parameters:
    ///   - control: The control variant's impression/conversion counts.
    ///   - treatment: The treatment variant's impression/conversion counts.
    ///   - confidenceThreshold: probability at which a side is declared the winner.
    public static func analyze(
        control: Variant,
        treatment: Variant,
        confidenceThreshold: Double = defaultConfidenceThreshold
    ) -> Result {
        // Posterior parameters: Beta(1,1) prior + observed data.
        let alphaC = Double(control.conversions) + 1
        let betaC = Double(control.impressions - control.conversions) + 1
        let alphaT = Double(treatment.conversions) + 1
        let betaT = Double(treatment.impressions - treatment.conversions) + 1

        let probability = probabilityBBeatsA(alphaA: alphaC, betaA: betaC, alphaB: alphaT, betaB: betaT)

        let controlRate = control.posteriorRate
        let treatmentRate = treatment.posteriorRate
        let liftPercent = controlRate > 0 ? ((treatmentRate - controlRate) / controlRate) * 100 : 0

        let winner: Result.Winner
        if probability >= confidenceThreshold {
            winner = .treatment(name: treatment.name)
        } else if (1 - probability) >= confidenceThreshold {
            winner = .control(name: control.name)
        } else {
            winner = .inconclusive
        }

        return Result(
            winner: winner,
            probabilityTreatmentBeatsControl: probability,
            liftPercent: liftPercent,
            controlRate: controlRate,
            treatmentRate: treatmentRate
        )
    }

    /// True once both variants have crossed the impression floor — i.e. an inconclusive
    /// result is now a legitimate "too close to call", not just "too early to tell".
    public static func hasSufficientData(control: Variant, treatment: Variant) -> Bool {
        control.impressions >= minimumImpressionsPerVariant
            && treatment.impressions >= minimumImpressionsPerVariant
    }

    // MARK: - Sample-ratio mismatch

    /// Detects sample-ratio mismatch: the observed impression split deviating from the
    /// configured weights badly enough to indicate a technical problem (caching, bot skew)
    /// rather than chance. Chi-square goodness-of-fit test with 1 degree of freedom; the
    /// conventional SRM alarm threshold is p < 0.001.
    ///
    /// Returns `false` (no mismatch) when there is not yet enough traffic to judge.
    public static func hasSampleRatioMismatch(
        control: Variant,
        treatment: Variant,
        expectedControlWeight: Double = 0.5,
        pValueThreshold: Double = 0.001
    ) -> Bool {
        let total = Double(control.impressions + treatment.impressions)
        guard total >= 100, expectedControlWeight > 0, expectedControlWeight < 1 else { return false }

        let expectedControl = total * expectedControlWeight
        let expectedTreatment = total * (1 - expectedControlWeight)
        let chiSquare =
            pow(Double(control.impressions) - expectedControl, 2) / expectedControl
            + pow(Double(treatment.impressions) - expectedTreatment, 2) / expectedTreatment

        // For 1 degree of freedom: p = erfc(sqrt(x/2)).
        let pValue = erfc((chiSquare / 2).squareRoot())
        return pValue < pValueThreshold
    }

    // MARK: - Plain-language formatting

    /// Formats a result as a plain-language summary for non-technical owners. The owner
    /// never needs to see the statistics vocabulary (port of `formatExperimentResult`).
    public static func formatSummary(experimentName: String, result: Result) -> String {
        let pct = { (n: Double) in String(format: "%.1f%%", n * 100) }
        let rates = "Original: \(pct(result.controlRate)) · Variant: \(pct(result.treatmentRate))"
        let liftRounded = Int(abs(result.liftPercent).rounded())

        switch result.winner {
        case .inconclusive:
            return [
                "**\(experimentName)**",
                "Too close to call — not enough data to pick a winner yet.",
                rates,
            ].joined(separator: "\n")
        case .control:
            let confPct = "\(Int(((1 - result.probabilityTreatmentBeatsControl) * 100).rounded()))%"
            return [
                "**\(experimentName)**",
                "The original is performing better by about \(liftRounded)%. "
                    + "We're \(confPct) confident this is a real difference.",
                rates,
            ].joined(separator: "\n")
        case .treatment(let name):
            let confPct = "\(Int((result.probabilityTreatmentBeatsControl * 100).rounded()))%"
            return [
                "**\(experimentName)**",
                "\(name) is outperforming the original by about \(liftRounded)%. "
                    + "We're \(confPct) confident this is a real difference.",
                rates,
            ].joined(separator: "\n")
        }
    }

    // MARK: - Templated suggestions

    /// One templated test idea from the default playbook.
    public struct Suggestion: Sendable, Equatable {
        public let title: String
        public let rationale: String
    }

    /// The retired skill's "default experiment playbook", as data instead of prose: what to
    /// test first when the owner has no specific idea, ordered by expected impact. One test
    /// at a time, sequential — no multivariate testing until traffic warrants it.
    public static let suggestionPlaybook: [Suggestion] = [
        Suggestion(
            title: "Hero headline",
            rationale: "The first thing every visitor reads. Specific, benefit-led headlines usually beat generic welcomes."),
        Suggestion(
            title: "Primary call-to-action copy",
            rationale: "The button visitors must click to convert. Action verbs and concrete outcomes beat vague labels."),
        Suggestion(
            title: "Social proof placement",
            rationale: "Reviews and testimonials near the decision point reduce hesitation."),
        Suggestion(
            title: "Contact form length",
            rationale: "Every extra field costs submissions. Try the shortest form that still gets you what you need."),
        Suggestion(
            title: "Pricing framing",
            rationale: "How a price is presented (per month, per use, anchored) changes how it reads."),
        Suggestion(
            title: "Page narrative structure",
            rationale: "Problem-first vs solution-first ordering suits different audiences — test which fits yours."),
    ]

    // MARK: - Exact Beta-Binomial comparison

    /// Exact P(B > A) for A ~ Beta(alphaA, betaA), B ~ Beta(alphaB, betaB) with integer
    /// parameters (Evan Miller's closed form). Deterministic — no sampling.
    static func probabilityBBeatsA(alphaA: Double, betaA: Double, alphaB: Double, betaB: Double) -> Double {
        var total = 0.0
        var i = 0.0
        while i < alphaB {
            total += exp(
                logBeta(alphaA + i, betaB + betaA)
                    - log(betaB + i)
                    - logBeta(1 + i, betaB)
                    - logBeta(alphaA, betaA)
            )
            i += 1
        }
        return min(max(total, 0), 1)
    }

    /// ln B(a, b) = ln Γ(a) + ln Γ(b) − ln Γ(a + b).
    static func logBeta(_ a: Double, _ b: Double) -> Double {
        logGamma(a) + logGamma(b) - logGamma(a + b)
    }

    /// Lanczos approximation of ln Γ(x) (g = 7, n = 9). Pure Swift so results are identical
    /// on every platform, unlike the libm `lgamma` whose sign-global variant is not
    /// thread-safe everywhere AnglesiteCore builds.
    static func logGamma(_ x: Double) -> Double {
        let coefficients: [Double] = [
            0.99999999999980993,
            676.5203681218851,
            -1259.1392167224028,
            771.32342877765313,
            -176.61502916214059,
            12.507343278686905,
            -0.13857109526572012,
            9.9843695780195716e-6,
            1.5056327351493116e-7,
        ]
        if x < 0.5 {
            // Reflection formula.
            return log(.pi / sin(.pi * x)) - logGamma(1 - x)
        }
        let xShifted = x - 1
        var accumulator = coefficients[0]
        for (index, coefficient) in coefficients.enumerated().dropFirst() {
            accumulator += coefficient / (xShifted + Double(index))
        }
        let t = xShifted + 7.5
        return 0.5 * log(2 * .pi) + (xShifted + 0.5) * log(t) - t + log(accumulator)
    }
}
