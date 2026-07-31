import Foundation

/// Resolves an ``IntegrationDescriptor`` plus the owner's ``Answers`` into a concrete
/// ``OperationPlan`` — the read-only half of the bucket-3 integration framework.
///
/// Planning is separated from applying (``IntegrationScaffolder``) so every failure a
/// descriptor can produce — missing provider, invalid field value, absent template asset,
/// duplicate append — surfaces *before* anything is written to the site, and the resulting
/// plan is pure data the wizard's review step can show the owner verbatim.
public enum IntegrationPlanner {
    /// Pure: no writes. Reads `global.css` for derived tokens only.
    public static func plan(
        descriptor: IntegrationDescriptor,
        answers: Answers,
        sourceDirectory: URL,
        templateDirectory: URL,
        fileManager: FileManager = .default
    ) -> Result<OperationPlan, IntegrationError> {
        var warnings: [PlanWarning] = []

        // 1. Provider check.
        let providerID = answers["provider"]
        if !descriptor.providers.isEmpty {
            guard let p = providerID, !p.isEmpty else { return .failure(.providerRequired) }
            guard descriptor.providers.contains(where: { $0.id == p }) else {
                return .failure(.unknownProvider(p))
            }
        }

        // 2. Build effective answers: fill field defaults where answer is missing/empty.
        var effective = answers
        for field in descriptor.fields {
            if effective[field.key]?.isEmpty != false, let def = field.defaultValue {
                effective[field.key] = def
            }
        }

        // 3. Validate visible fields using effective answers.
        for field in descriptor.fields where isVisible(field.visibleWhen, answers: effective, providerID: providerID) {
            let value = effective[field.key] ?? ""
            if value.isEmpty {
                if field.isOptional { continue }
                return .failure(.missingRequiredField(key: field.key))
            }
            switch field.kind {
            case .email where !value.contains("@"):
                return .failure(.invalidValue(key: field.key, reason: "not an email address"))
            // Delegates to the single "is this a URL" rule (ContentFieldValidation.isAbsoluteURL)
            // so a value like "https:" or "mailto:foo@bar.com" fails here with a clear message,
            // instead of silently producing no CSP entry later for a descriptor that uses
            // addCSPDomains(fromFieldHost:).
            case .url where !ContentFieldValidation.isAbsoluteURL(value):
                return .failure(.invalidValue(key: field.key, reason: "not an absolute URL (needs a host, e.g. https://example.com)"))
            case .path where value.contains(where: { $0.isWhitespace }):
                return .failure(.invalidValue(key: field.key, reason: "must not contain whitespace"))
            case .path where !(value.hasPrefix("/") || URL(string: value)?.host != nil):
                return .failure(.invalidValue(key: field.key, reason: "must start with / or be an absolute URL"))
            case .choice(let choices) where !choices.contains(where: { $0.value == value }):
                return .failure(.invalidValue(key: field.key, reason: "not one of the allowed choices"))
            default: break
            }
        }

        // 4. Tokens = effective answers + derived inputs.
        var tokens = effective
        if let brand = brandColor(sourceDirectory: sourceDirectory, fileManager: fileManager) {
            tokens["brandColor"] = brand
        } else {
            tokens["brandColor"] = "#000000"
            if descriptor.operations.contains(where: { operationReferences("brandColor", $0) }) {
                warnings.append(PlanWarning("Couldn't read the site's brand color; used a default."))
            }
        }
        if let name = siteName(sourceDirectory: sourceDirectory, fileManager: fileManager) {
            tokens["siteName"] = name
        } else {
            tokens["siteName"] = "My Site"
            if descriptor.operations.contains(where: { operationReferences("siteName", $0) }) {
                warnings.append(PlanWarning("Couldn't read the site's name; used a default."))
            }
        }

        // 5. Resolve operations into concrete steps using effective answers.
        var steps: [PlannedStep] = []
        for op in descriptor.operations {
            switch op {
            case .copyFile(let from, let to, let when):
                guard isVisible(when, answers: effective, providerID: providerID) else { continue }
                let dest = to.resolve(tokens)
                let src = templateDirectory.appendingPathComponent(from.path)
                guard let contents = try? String(contentsOf: src, encoding: .utf8) else {
                    // Hard-fail: skipping the copy would leave the descriptor's matching `import`
                    // injection pointing at a file that was never written — a deferred Astro build
                    // break. Surface it now as a clear, up-front error instead.
                    return .failure(.missingTemplateAsset(path: from.path))
                }
                steps.append(.createFile(relativePath: dest, contents: contents))
            case .copyTemplatedFile(let from, let to, let when):
                guard isVisible(when, answers: effective, providerID: providerID) else { continue }
                let dest = to.resolve(tokens)
                let src = templateDirectory.appendingPathComponent(from.path)
                guard let contents = try? String(contentsOf: src, encoding: .utf8) else {
                    return .failure(.missingTemplateAsset(path: from.path))
                }
                steps.append(.createFile(relativePath: dest, contents: Template(contents).resolve(tokens)))
            case .writeConfig(let entries, let when):
                guard isVisible(when, answers: effective, providerID: providerID) else { continue }
                steps.append(.upsertConfig(entries.map { ConfigKV(key: $0.key, value: $0.value.resolve(tokens)) }))
            case .addCSPDomains(let fromProvider, let extra, let fromFieldHost, let when):
                guard isVisible(when, answers: effective, providerID: providerID) else { continue }
                var domains = extra
                if fromProvider, let p = providerID,
                   let provider = descriptor.providers.first(where: { $0.id == p }) {
                    domains = provider.cspDomains + extra
                }
                if let key = fromFieldHost, let value = effective[key], let host = URL(string: value)?.host {
                    domains.append(host)
                }
                if !domains.isEmpty { steps.append(.addCSP(domains)) }
            case .injectAtAnchor(let file, let anchor, let snippet, let when, let style):
                guard isVisible(when, answers: effective, providerID: providerID) else { continue }
                steps.append(.injectAnchor(
                    relativeFile: file.resolve(tokens),
                    anchor: anchor,
                    id: descriptor.id.rawValue,
                    snippet: snippet.resolve(tokens),
                    style: style
                ))
            case .appendLine(let file, let line, let when):
                guard isVisible(when, answers: effective, providerID: providerID) else { continue }
                let resolvedFile = file.resolve(tokens)
                let resolvedLine = line.resolve(tokens)
                if lineAlreadyExists(resolvedLine, inFileAt: resolvedFile, sourceDirectory: sourceDirectory, fileManager: fileManager) {
                    return .failure(.duplicateLine(file: resolvedFile))
                }
                steps.append(.appendLine(relativePath: resolvedFile, line: resolvedLine))
            }
        }

        return .success(OperationPlan(integrationID: descriptor.id, steps: steps, warnings: warnings))
    }

    // Internal (not private) so Task 9's wizard model can call it from the same module.
    static func isVisible(_ condition: Condition, answers: Answers, providerID: String?) -> Bool {
        switch condition {
        case .always: return true
        case .providerIs(let p): return providerID == p
        case .fieldEquals(let key, let value): return answers[key] == value
        case .fieldIn(let key, let values): return values.contains(answers[key] ?? "")
        }
    }

    private static func operationReferences(_ token: String, _ op: Operation) -> Bool {
        let needle = "{{\(token)}}"
        switch op {
        case .copyFile(_, let to, _), .copyTemplatedFile(_, let to, _): return to.raw.contains(needle)
        case .writeConfig(let entries, _): return entries.contains { $0.value.raw.contains(needle) }
        case .injectAtAnchor(let file, _, let snippet, _, _): return file.raw.contains(needle) || snippet.raw.contains(needle)
        case .appendLine(let file, let line, _): return file.raw.contains(needle) || line.raw.contains(needle)
        case .addCSPDomains: return false
        }
    }

    private static func brandColor(sourceDirectory: URL, fileManager: FileManager) -> String? {
        let css = sourceDirectory.appendingPathComponent("src/styles/global.css")
        guard let text = try? String(contentsOf: css, encoding: .utf8) else { return nil }
        guard let r = text.range(of: "--color-primary:") else { return nil }
        let rest = text[r.upperBound...]
        guard let semi = rest.firstIndex(of: ";") else { return nil }
        return rest[..<semi].trimmingCharacters(in: .whitespaces)
    }

    private static func siteName(sourceDirectory: URL, fileManager: FileManager) -> String? {
        let config = sourceDirectory.appendingPathComponent(".site-config")
        guard let text = try? String(contentsOf: config, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n") {
            guard let eq = line.firstIndex(of: "=") else { continue }
            let key = line[line.startIndex..<eq]
            guard key == "SITE_NAME" else { continue }
            let value = line[line.index(after: eq)...]
            return value.trimmingCharacters(in: .whitespaces)
        }
        return nil
    }

    /// Whether `line` (trimmed) already exists verbatim (trimmed) as a line in the target file.
    /// A missing file/directory just means "not present yet" — not an error.
    private static func lineAlreadyExists(
        _ line: String, inFileAt relativePath: String, sourceDirectory: URL, fileManager: FileManager
    ) -> Bool {
        let url = sourceDirectory.appendingPathComponent(relativePath)
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return false }
        let target = line.trimmingCharacters(in: .whitespaces)
        return text.split(separator: "\n").contains { $0.trimmingCharacters(in: .whitespaces) == target }
    }
}
