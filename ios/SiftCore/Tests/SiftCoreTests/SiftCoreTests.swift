import Foundation
import XCTest
@testable import SiftCore

final class SiftCoreTests: XCTestCase {
    private func sample() throws -> EnrichedProduct {
        // Tests/SiftCoreTests/file -> repository root, independent of the working directory.
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let data = try Data(contentsOf: root.appendingPathComponent("contracts/enriched_sample.json"))
        return try JSONDecoder().decode(EnrichedProduct.self, from: data)
    }

    func testBackendContract() throws {
        let product = try sample()
        XCTAssertEqual(product.facts.kbVersion, "0.2.0")
        XCTAssertTrue(product.facts.hasIngredients)
        XCTAssertTrue(product.facts.categoryHits.contains { $0.impliedBy == "wheat" })
        XCTAssertTrue(product.facts.categoryHits.contains { $0.fromMayContain })
        XCTAssertFalse(product.facts.ambiguous.isEmpty)
        XCTAssertEqual(product.nutrientsPer100g["sodium_mg"], 600)
        XCTAssertEqual(product.religious.kosher?.status, .forbiddenIngredient)
        XCTAssertEqual(product.warnings, ["crowd_sourced_check_the_package"])
    }

    func testDefiniteConflictWinsOverUncertainty() throws {
        let verdict = RuleEngine.decide(try sample(), profile: .init(avoid: ["dairy"]))
        XCTAssertEqual(verdict.level, .avoid)
        XCTAssertTrue(verdict.findings.contains { $0.level == .notSure })
        XCTAssertEqual(verdict.findings.first?.level, .avoid)
    }

    func testMayContainUsesPolicy() throws {
        var product = try sample()
        product.facts.ambiguous = []
        XCTAssertEqual(RuleEngine.decide(product, profile: .init(avoid: ["tree_nut"])).level, .caution)
        XCTAssertEqual(RuleEngine.decide(product, profile: .init(avoid: ["tree_nut"], doubtfulPolicy: .avoid)).level, .avoid)
    }

    func testMissingIngredientsIsNotSure() throws {
        var product = try sample()
        product.facts.hasIngredients = false
        XCTAssertEqual(RuleEngine.decide(product, profile: .init()).level, .notSure)
    }

    func testIncompleteIngredientWarningIsNotSure() throws {
        var product = try sample()
        product.warnings.append("ingredient_data_conflict")
        XCTAssertEqual(RuleEngine.decide(product, profile: .init()).level, .notSure)
        XCTAssertEqual(RuleEngine.decide(product, profile: .init(avoid: ["dairy"])).level, .avoid)
    }

    func testUnrelatedRestrictionsHaveNoListedConflicts() throws {
        XCTAssertEqual(RuleEngine.decide(try sample(), profile: .init(avoid: ["egg"])).level, .good)
    }

    func testReligiousStatusAndAcceptedCertifiers() throws {
        var product = try sample()
        let profile = Profile(kosher: .init(on: true, accepted: ["ou"]))
        XCTAssertEqual(RuleEngine.decide(product, profile: profile).level, .avoid)
        product.religious.kosher?.status = .certified
        XCTAssertEqual(RuleEngine.decide(product, profile: profile).level, .caution)
        product.religious.kosher?.certifications = [try JSONDecoder().decode(
            Certification.self,
            from: Data(#"{"agencyId":"ou","agencyName":"OU","confidence":"high"}"#.utf8))]
        XCTAssertEqual(RuleEngine.decide(product, profile: profile).level, .good)
        product.religious.kosher = nil
        XCTAssertEqual(RuleEngine.decide(product, profile: profile).level, .notSure)
    }

    func testReligiousUncertaintyAndPolicy() throws {
        var product = try sample()
        for status in [ReligiousStatus.conflictingData, .insufficientData] {
            product.religious.halal?.status = status
            XCTAssertEqual(RuleEngine.decide(product, profile: .init(
                halal: .init(on: true), doubtfulPolicy: .avoid)).level, .notSure)
        }
        for status in [ReligiousStatus.notCertified, .doubtfulIngredient] {
            product.religious.halal?.status = status
            XCTAssertEqual(RuleEngine.decide(product, profile: .init(
                halal: .init(on: true))).level, .caution)
            XCTAssertEqual(RuleEngine.decide(product, profile: .init(
                halal: .init(on: true), doubtfulPolicy: .avoid)).level, .avoid)
        }
    }

    func testProductResponseEnvelope() throws {
        let enriched = try JSONSerialization.jsonObject(with: JSONEncoder().encode(sample()))
        let data = try JSONSerialization.data(withJSONObject: [
            "barcode": "123456789012", "sources": ["open_food_facts"],
            "fromCache": false, "product": ["name": "Example"], "enriched": enriched
        ])
        let response = try JSONDecoder().decode(ProductResponse.self, from: data)
        XCTAssertEqual(response.product.name, "Example")
        XCTAssertNil(response.product.brand)
        XCTAssertEqual(response.enriched.facts.ingredients.count, 6)
    }
}
