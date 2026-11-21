public enum Level: String, Codable, Sendable {
    case good, notSure = "not_sure", caution, avoid

    public var rank: Int {
        switch self {
        case .good: 0
        case .notSure: 1
        case .caution: 2
        case .avoid: 3
        }
    }
}

public enum DoubtfulPolicy: String, Codable, Sendable {
    case caution, avoid
    public var level: Level { self == .avoid ? .avoid : .caution }
}

public struct SchemePreference: Codable, Sendable {
    public var on: Bool
    public var accepted: [String]
    public init(on: Bool = false, accepted: [String] = []) {
        self.on = on
        self.accepted = accepted
    }
}

public struct Profile: Codable, Sendable {
    public var version: Int = 1
    public var avoid: [String]
    public var kosher: SchemePreference
    public var halal: SchemePreference
    public var doubtfulPolicy: DoubtfulPolicy

    public init(avoid: [String] = [], kosher: SchemePreference = .init(),
                halal: SchemePreference = .init(), doubtfulPolicy: DoubtfulPolicy = .caution) {
        self.avoid = avoid
        self.kosher = kosher
        self.halal = halal
        self.doubtfulPolicy = doubtfulPolicy
    }
}

public struct Finding: Equatable, Sendable {
    public var level: Level
    public var source: String
    public var detail: String
}

public struct Verdict: Equatable, Sendable {
    public var level: Level
    public var findings: [Finding]
}

/// Runs locally; the profile is never sent to the API. Good means no listed conflicts.
public enum RuleEngine {
    public static func decide(_ product: EnrichedProduct, profile: Profile) -> Verdict {
        var findings: [Finding] = []
        let facts = product.facts
        let avoided = Set(profile.avoid)
        let doubtful = profile.doubtfulPolicy.level

        if product.warnings.contains("ingredient_data_conflict") {
            findings.append(.init(level: .notSure, source: "data",
                                  detail: "Ingredient data may be incomplete. Check the full package label."))
        }

        if !facts.hasIngredients {
            findings.append(.init(level: .notSure, source: "data", detail: "No ingredient list"))
        }
        for hit in facts.categoryHits where avoided.contains(hit.categoryId) {
            let definite = hit.certainty == .definite && !hit.fromMayContain
            findings.append(.init(level: definite ? .avoid : doubtful,
                                  source: hit.fromMayContain ? "may_contain" : "ingredients",
                                  detail: "\(hit.categoryId): \(hit.ingredient)"))
        }
        for item in facts.ambiguous where !avoided.isDisjoint(with: item.mightBelongTo) {
            findings.append(.init(level: .notSure, source: "ambiguous", detail: item.ingredient))
        }
        for scheme in [Scheme.kosher, .halal] {
            let preference = scheme == .kosher ? profile.kosher : profile.halal
            guard preference.on else { continue }
            guard let assessment = product.religious[scheme] else {
                findings.append(.init(level: .notSure, source: scheme.rawValue, detail: "No information"))
                continue
            }
            let level: Level
            switch assessment.status {
            case .certified:
                let trusted = assessment.certifications.contains {
                    guard let id = $0.agencyId else { return false }
                    return preference.accepted.contains(id)
                }
                level = trusted ? .good : .caution
            case .forbiddenIngredient: level = .avoid
            case .conflictingData, .insufficientData: level = .notSure
            case .doubtfulIngredient, .notCertified: level = doubtful
            case .noListedConflicts: level = .good
            }
            findings.append(.init(level: level, source: scheme.rawValue, detail: assessment.summary))
        }
        // Preserve input order for findings with equal severity.
        findings = findings.enumerated().sorted {
            $0.element.level.rank == $1.element.level.rank
                ? $0.offset < $1.offset : $0.element.level.rank > $1.element.level.rank
        }.map(\.element)
        return Verdict(level: findings.first?.level ?? .good, findings: findings)
    }
}
