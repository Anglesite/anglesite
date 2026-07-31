import Foundation

/// Static description of which on-device AI capabilities this build supports, computed once via
/// `canImport`/`compiler` checks so callers (routing, UI, diagnostics) check a flag instead of
/// scattering `#if canImport(FoundationModels)` throughout `AnglesiteApp` (cross-platform port
/// design §5/§10).
public enum PlatformCapabilities {
    /// Whether a `FoundationModelAssistant` (and the FoundationModels-backed tools alongside it)
    /// can exist in this build. `false` off-Darwin, and on Darwin builds using a pre-Xcode-27
    /// toolchain where `FoundationModels` is absent at runtime (#128).
    public static let hasAssistant: Bool = {
        #if compiler(>=6.4) && canImport(FoundationModels)
        return true
        #else
        return false
        #endif
    }()

    /// Whether an on-device NaturalLanguage embedding model (``NLEmbeddingProvider`` /
    /// ``NLContextualEmbeddingProvider``) is available. `false` off-Darwin, where
    /// ``SemanticRanker`` callers fall back to ``LexicalEmbeddingProvider``.
    public static let hasEmbeddings: Bool = {
        #if canImport(NaturalLanguage)
        return true
        #else
        return false
        #endif
    }()

    /// Coarse label for the AI backend this build falls back to — diagnostics/telemetry only;
    /// routing decisions should check ``hasAssistant``/``hasEmbeddings`` directly.
    public enum ModelTier: String, Sendable, Equatable {
        /// Apple's on-device FoundationModels + NaturalLanguage are available.
        case onDevice
        /// Neither is available; callers use ``LexicalEmbeddingProvider`` and hide
        /// assistant-dependent features rather than degrade to a cloud call (LLM policy, #459).
        case unavailable
    }

    /// The ``ModelTier`` this build resolves to, derived from ``hasAssistant``. A computed label
    /// for diagnostics/telemetry surfaces — feature routing should branch on the individual
    /// capability flags instead, so a future intermediate tier can't silently change behavior.
    public static var modelTier: ModelTier {
        hasAssistant ? .onDevice : .unavailable
    }
}
