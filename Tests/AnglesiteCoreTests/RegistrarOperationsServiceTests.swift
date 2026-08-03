import Foundation
import Testing
@testable import AnglesiteCore

struct RegistrarOperationsServiceTests {
    private func service(
        reader: FakeRegistrarReader = FakeRegistrarReader(),
        writer: FakeRegistrarWriter = FakeRegistrarWriter(),
        token: String? = "tok"
    ) -> RegistrarOperations {
        RegistrarOperations(reader: reader, writer: writer, tokenProvider: { token })
    }

    @Test("searchDomains resolves the reader's names")
    func searchSucceeds() async {
        let reader = FakeRegistrarReader(searchNames: ["example.dev"])
        let result = await service(reader: reader).searchDomains(query: "example")
        guard case .success(let names) = result else { Issue.record("expected success"); return }
        #expect(names == ["example.dev"])
        #expect(reader.searchedQuery == "example")
    }

    @Test("searchDomains fails with .noToken when no token is available")
    func searchNoToken() async {
        let result = await service(token: nil).searchDomains(query: "example")
        guard case .failure(.noToken) = result else { Issue.record("expected .noToken"); return }
    }

    @Test("searchDomains surfaces a CloudflareError as .cloudflare")
    func searchCloudflareError() async {
        let reader = FakeRegistrarReader(searchError: .unauthorized)
        let result = await service(reader: reader).searchDomains(query: "example")
        guard case .failure(.cloudflare(.unauthorized)) = result else { Issue.record("expected .cloudflare(.unauthorized)"); return }
    }

    @Test("checkDomainAvailability resolves the reader's results")
    func checkSucceeds() async {
        let reader = FakeRegistrarReader(checkResults: [
            RegistrarDomainCheck(name: "example.dev", registrable: true, reason: nil, registrationCost: "10.11", currency: "USD"),
        ])
        let result = await service(reader: reader).checkDomainAvailability(domains: ["example.dev"])
        guard case .success(let checks) = result else { Issue.record("expected success"); return }
        #expect(checks.count == 1)
        #expect(reader.checkedDomains == ["example.dev"])
    }

    @Test("registerDomain resolves the writer's outcome")
    func registerSucceeds() async {
        let writer = FakeRegistrarWriter(registerOutcome: .succeeded)
        let result = await service(writer: writer).registerDomain(name: "example.dev")
        guard case .success(.succeeded) = result else { Issue.record("expected success(.succeeded)"); return }
        #expect(writer.registeredName == "example.dev")
    }

    @Test("registerDomain fails with .noToken when no token is available")
    func registerNoToken() async {
        let result = await service(token: nil).registerDomain(name: "example.dev")
        guard case .failure(.noToken) = result else { Issue.record("expected .noToken"); return }
    }
}

// MARK: - Fakes

final class FakeRegistrarReader: CloudflareRegistrarReading, @unchecked Sendable {
    private let searchNames: [String]
    private let searchError: CloudflareError?
    private let checkResults: [RegistrarDomainCheck]
    private(set) var searchedQuery: String?
    private(set) var checkedDomains: [String] = []

    init(searchNames: [String] = [], searchError: CloudflareError? = nil, checkResults: [RegistrarDomainCheck] = []) {
        self.searchNames = searchNames
        self.searchError = searchError
        self.checkResults = checkResults
    }

    func searchDomains(query: String, apiToken: String) async throws -> [String] {
        searchedQuery = query
        if let searchError { throw searchError }
        return searchNames
    }
    func checkDomainAvailability(domains: [String], apiToken: String) async throws -> [RegistrarDomainCheck] {
        checkedDomains = domains
        return checkResults
    }
}

final class FakeRegistrarWriter: CloudflareRegistrarWriting, @unchecked Sendable {
    private let registerOutcome: RegistrarRegistrationOutcome
    private(set) var registeredName: String?

    init(registerOutcome: RegistrarRegistrationOutcome = .succeeded) {
        self.registerOutcome = registerOutcome
    }

    func registerDomain(name: String, apiToken: String) async throws -> RegistrarRegistrationOutcome {
        registeredName = name
        return registerOutcome
    }
}
