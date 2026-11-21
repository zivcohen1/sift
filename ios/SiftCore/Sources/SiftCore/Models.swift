import Foundation

public enum Certainty: String, Codable, Sendable { case definite, possible }
public enum Scheme: String, Codable, Sendable { case kosher, halal }
public enum ReligiousStatus: String, Codable, Sendable {
    case certified, forbiddenIngredient = "forbidden_ingredient"
    case conflictingData = "conflicting_data", doubtfulIngredient = "doubtful_ingredient"
    case notCertified = "not_certified", noListedConflicts = "no_listed_conflicts"
    case insufficientData = "insufficient_data"
}

public struct CategoryHit: Codable, Sendable {
    public var categoryId: String
    public var term: String
    public var certainty: Certainty
    public var ingredient: String
    public var fromMayContain: Bool
    public var impliedBy: String?
}

public struct AmbiguousItem: Codable, Sendable {
    public var name: String
    public var ingredient: String
    public var mightBelongTo: [String]
}

public struct ProductFacts: Codable, Sendable {
    public var ingredients: [String]
    public var mayContain: [String]
    public var hasIngredients: Bool
    public var categoryHits: [CategoryHit]
    public var ambiguous: [AmbiguousItem]
    public var kbVersion: String
}

public struct Certification: Codable, Sendable {
    public enum Confidence: String, Codable, Sendable { case low, medium, high }
    public var agencyId: String?
    public var agencyName: String
    public var confidence: Confidence
}

public struct ReligiousAssessment: Codable, Sendable {
    public struct Concern: Codable, Sendable {
        public enum Severity: String, Codable, Sendable { case forbidden, doubtful }
        public var ingredient: String
        public var severity: Severity
    }
    public var scheme: Scheme
    public var status: ReligiousStatus
    public var certifications: [Certification]
    public var concerns: [Concern]
    public var summary: String
}

public struct ReligiousAssessments: Codable, Sendable {
    public var kosher: ReligiousAssessment?
    public var halal: ReligiousAssessment?

    public subscript(scheme: Scheme) -> ReligiousAssessment? {
        scheme == .kosher ? kosher : halal
    }
}

public struct EnrichedProduct: Codable, Sendable {
    public var facts: ProductFacts
    public var nutrientsPer100g: [String: Double]
    public var religious: ReligiousAssessments
    public var warnings: [String]
}

public struct ProductInfo: Codable, Sendable {
    public var barcode: String?
    public var name: String?
    public var brand: String?
    public var imageUrl: String?
    public var ingredientsText: String?
    public var sourceUrl: String?
}

public struct ProductResponse: Codable, Sendable {
    public var barcode: String
    public var sources: [String]
    public var fromCache: Bool
    public var product: ProductInfo
    public var enriched: EnrichedProduct
}
