import Foundation

/// Pure mutation helpers for `DomainConfig`'s array-typed fields (#1170). `DomainConfigStore.save`
/// deep-merges *objects* but replaces *arrays* wholesale (see its own doc comment), so any writer
/// that wants to grow an array field across repeated runs — instead of clobbering it with just
/// this run's records — must load the current value, combine it here, and save the combined
/// result. Kept in its own file (not `DomainConfig.swift`) so this slice's diff stays separate
/// from #1169's schema/store surface.
extension DomainConfig {
    /// Appends `record` to `dns.managedRecords`, de-duplicating an exact repeat (case-insensitive
    /// `type`, exact `name`/`content`) so re-running an idempotent add-if-absent flow (e.g. the
    /// MTA-STS publish flow, which already skips the Cloudflare call for a matching record) never
    /// grows the file with a duplicate entry.
    func addingManagedDNSRecord(_ record: DomainConfig.DNSRecord) -> DomainConfig {
        var copy = self
        var existing = copy.dns?.managedRecords ?? []
        let isDuplicate = existing.contains {
            $0.type.caseInsensitiveCompare(record.type) == .orderedSame
                && $0.name == record.name && $0.content == record.content
        }
        guard !isDuplicate else { return copy }
        existing.append(record)
        copy.dns = DNS(managedRecords: existing)
        return copy
    }

    /// Removes every entry matching `type`/`name`/`content` (case-insensitive `type`) from
    /// `dns.managedRecords`. Matched by content triple, not a Cloudflare record ID — this schema
    /// deliberately never stores Cloudflare-assigned IDs (investigation doc §5.2 exclusion list).
    func removingManagedDNSRecord(type: String, name: String, content: String) -> DomainConfig {
        var copy = self
        guard var existing = copy.dns?.managedRecords else { return copy }
        existing.removeAll {
            $0.type.caseInsensitiveCompare(type) == .orderedSame
                && $0.name == name && $0.content == content
        }
        copy.dns = DNS(managedRecords: existing)
        return copy
    }
}

extension DomainConfig.Edge.CloudflareEdge {
    /// Appends `newRules` onto `existing`, de-duplicating exact repeats (`Equatable`) — the
    /// `edge.cloudflare.wafRules` counterpart to `DomainConfig.addingManagedDNSRecord`, needed
    /// because a second Harden run must not erase WAF rules an earlier run already declared.
    static func accumulatingWAFRules(
        _ newRules: [DomainConfig.Edge.WAFRule], onto existing: [DomainConfig.Edge.WAFRule]
    ) -> [DomainConfig.Edge.WAFRule] {
        var result = existing
        for rule in newRules where !result.contains(rule) {
            result.append(rule)
        }
        return result
    }
}
