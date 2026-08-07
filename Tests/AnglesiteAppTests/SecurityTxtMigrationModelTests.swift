import Testing
import AnglesiteCore
@testable import AnglesiteAppCore

@MainActor
@Suite struct SecurityTxtMigrationModelTests {
    @Test func adoptForwardsTheAdoptDecision() {
        var decisions: [SecurityTxtMigrationApplier.Decision] = []
        let model = SecurityTxtMigrationModel { decisions.append($0) }
        model.adopt()
        #expect(decisions == [.adopt])
    }

    @Test func preserveForwardsThePreserveDecision() {
        var decisions: [SecurityTxtMigrationApplier.Decision] = []
        let model = SecurityTxtMigrationModel { decisions.append($0) }
        model.preserve()
        #expect(decisions == [.preserve])
    }
}
