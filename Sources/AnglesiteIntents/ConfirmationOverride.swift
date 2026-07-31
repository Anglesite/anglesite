/// Test seam for the confirmation outcome. `requestConfirmation` is not introspectable under
/// `swift test` (no intentsd / registered app), so the decline-path test drives this instead.
public enum ConfirmationDecision: Sendable {
    /// Proceed as if the user accepted Siri's confirmation dialog — the intent falls through
    /// to the apply step.
    case confirm
    /// Abort as if the user declined — ``EditContentIntent`` returns its "Okay, I won't
    /// change …" dialog before applying anything, leaving the page untouched.
    case decline
}

/// `@TaskLocal` binding point for ``ConfirmationDecision``. ``EditContentIntent`` consults
/// ``scoped`` before calling `requestConfirmation`: a bound value short-circuits the real Siri
/// dialog entirely (there is no way to programmatically answer one), while `nil` — always the
/// case in production — falls through to the real confirmation. Same task-local pattern as
/// `ContentGraphOverride` / `SiteOperationsOverride`.
public enum ConfirmationOverride {
    /// The decision for the current task tree. Defaults to `nil` (real confirmation dialog);
    /// tests bind it with `ConfirmationOverride.$scoped.withValue(...)` around the intent's
    /// perform call.
    @TaskLocal public static var scoped: ConfirmationDecision?
}
