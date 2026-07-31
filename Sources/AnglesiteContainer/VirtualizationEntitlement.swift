import Foundation
import Security

/// Reads `com.apple.security.virtualization` from this process's signed entitlements. Returns false
/// for unsigned/un-entitled builds (every CI build and any pre-approval distribution). Lives here
/// because AnglesiteContainer is the only target that should ever consult it.
public enum VirtualizationEntitlement {
    /// `true` when the running process's code signature carries the virtualization entitlement.
    /// Queried via `SecTask` (not a static build flag) so the answer reflects the binary as
    /// actually signed — an ad-hoc or unsigned test build correctly reports `false`.
    public static var isPresent: Bool {
        guard let task = SecTaskCreateFromSelf(nil) else { return false }
        let value = SecTaskCopyValueForEntitlement(task, "com.apple.security.virtualization" as CFString, nil)
        return (value as? Bool) == true
    }
}
