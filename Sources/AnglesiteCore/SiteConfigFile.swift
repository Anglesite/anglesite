// Sources/AnglesiteCore/SiteConfigFile.swift
import Foundation

public enum SiteConfigFile {
    public static let cspKey = "SCRIPT_ALLOW"

    public static func upsert(_ entries: [(key: String, value: String)], into contents: String) -> String {
        // Normalize CRLF to LF so stray \r don't appear in split lines or output.
        let contents = contents.replacingOccurrences(of: "\r\n", with: "\n")
        var lines = contents.isEmpty ? [] : contents.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        if lines.last == "" { lines.removeLast() }  // normalize trailing newline
        for (key, value) in entries {
            let line = "\(key)=\(value)"
            if let i = lines.firstIndex(where: { $0.hasPrefix("\(key)=") }) {
                lines[i] = line
            } else {
                lines.append(line)
            }
        }
        return lines.isEmpty ? "" : lines.joined(separator: "\n") + "\n"
    }

    public static func addCSPDomains(_ domains: [String], into contents: String) -> String {
        let existing = cspDomains(in: contents)
        var merged = existing
        for d in domains where !merged.contains(d) { merged.append(d) }
        return upsert([(cspKey, merged.joined(separator: ","))], into: contents)
    }

    /// Drops `domains` from the `SCRIPT_ALLOW` list, leaving other entries in place.
    /// No-op when the key is absent — it isn't created just to hold an empty value.
    public static func removeCSPDomains(_ domains: [String], from contents: String) -> String {
        guard contents.split(separator: "\n").contains(where: { $0.hasPrefix("\(cspKey)=") }) else {
            return contents
        }
        let remaining = cspDomains(in: contents).filter { !domains.contains($0) }
        return upsert([(cspKey, remaining.joined(separator: ","))], into: contents)
    }

    private static func cspDomains(in contents: String) -> [String] {
        let existingLine = contents.split(separator: "\n").first { $0.hasPrefix("\(cspKey)=") }
        return existingLine.map { String($0.dropFirst(cspKey.count + 1)) }
            .map { $0.split(separator: ",").map(String.init) } ?? []
    }

    /// Reads a single `KEY=value` line's value from `.site-config`-formatted
    /// contents, or `nil` if the key isn't present. Lines starting with `#`
    /// (comments) never match, even if they look like `# KEY=value`.
    public static func value(forKey key: String, in contents: String) -> String? {
        for line in contents.split(separator: "\n") {
            guard line.hasPrefix("\(key)=") else { continue }
            return String(line.dropFirst(key.count + 1))
        }
        return nil
    }
}
