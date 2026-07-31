// Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("ContentTypeRegistry")
struct ContentTypeRegistryTests {

    // MARK: Registry mechanics

    @Test("default registry exposes the built-in catalog in order, looked up by id")
    func defaultRegistry() {
        let registry = ContentTypeRegistry()
        #expect(registry.all.map(\.id) == registry.ids)
        #expect(registry.ids == ContentTypeRegistry.builtIns.map(\.id))
        #expect(registry.descriptor(id: "note") != nil)
        #expect(registry.descriptor(id: "businessProfile") != nil)
        #expect(registry.descriptor(id: "nope") == nil)
    }

    @Test("registering a new type appends; the registry surfaces it by id")
    func registerAppends() {
        var registry = ContentTypeRegistry(types: [])
        #expect(registry.all.isEmpty)
        let custom = ContentTypeDescriptor(
            id: "recipe",
            displayName: "Recipe",
            storage: .collection("recipes"),
            fields: [ContentTypeField("title", .string, required: true)],
            projections: ContentTypeProjections(
                microformat: "h-recipe",
                microformatProperties: ["title": "p-name"],
                schemaType: "Recipe"
            )
        )
        registry.register(custom)
        #expect(registry.ids == ["recipe"])
        #expect(registry.descriptor(id: "recipe") == custom)
    }

    @Test("re-registering an id replaces in place and keeps its position")
    func registerReplacesInPlace() throws {
        var registry = ContentTypeRegistry()  // built-ins
        let originalOrder = registry.ids
        let position = try #require(originalOrder.firstIndex(of: "article"))
        let overridden = ContentTypeDescriptor(
            id: "article",
            displayName: "Long-form Article",
            storage: .collection("articles"),
            fields: [ContentTypeField("title", .string, required: true)],
            projections: ContentTypeProjections(
                microformat: "h-entry",
                microformatProperties: ["title": "p-name"],
                schemaType: "Article"
            )
        )
        registry.register(overridden)
        #expect(registry.ids == originalOrder)                       // order unchanged
        #expect(registry.ids.firstIndex(of: "article") == position)  // same slot
        #expect(registry.descriptor(id: "article")?.displayName == "Long-form Article")
    }

    @Test("init de-dupes by id, last-wins, first-seen order")
    func initDeDupes() {
        let a1 = ContentTypeDescriptor(
            id: "x", displayName: "First", storage: .page, fields: [],
            projections: ContentTypeProjections(microformat: "h-entry", microformatProperties: [:], schemaType: nil))
        let a2 = ContentTypeDescriptor(
            id: "x", displayName: "Second", storage: .page, fields: [],
            projections: ContentTypeProjections(microformat: "h-entry", microformatProperties: [:], schemaType: nil))
        let registry = ContentTypeRegistry(types: [a1, a2])
        #expect(registry.ids == ["x"])
        #expect(registry.descriptor(id: "x")?.displayName == "Second")
    }

    // MARK: Per-type declarations (≥3 types, distinct microformats + schema.org)

    @Test("Article projects h-entry + schema.org Article, with required body and date")
    func articleType() throws {
        let article = try #require(ContentTypeRegistry().descriptor(id: "article"))
        #expect(article.storage == .collection("articles"))
        #expect(article.collection == "articles")
        #expect(article.projections.microformat == "h-entry")
        #expect(article.projections.schemaType == "Article")
        #expect(article.projections.microformatProperties["title"] == "p-name")
        #expect(article.projections.microformatProperties["body"] == "e-content")
        #expect(article.projections.microformatProperties["publishDate"] == "dt-published")
        let required = Set(article.fields.filter(\.required).map(\.name))
        #expect(required == ["title", "body", "publishDate"])
    }

    @Test("Event projects h-event + schema.org Event with dt-start/dt-end")
    func eventType() throws {
        let event = try #require(ContentTypeRegistry().descriptor(id: "event"))
        #expect(event.projections.microformat == "h-event")
        #expect(event.projections.schemaType == "Event")
        #expect(event.projections.microformatProperties["start"] == "dt-start")
        #expect(event.projections.microformatProperties["end"] == "dt-end")
        // h-event dt-start/dt-end are datetimes (ISO 8601 with time + timezone), not bare dates.
        #expect(event.fields.first { $0.name == "start" }?.kind == .datetime)
        #expect(event.fields.first { $0.name == "end" }?.kind == .datetime)
    }

    @Test("Review projects h-review + schema.org Review with a numeric rating")
    func reviewType() throws {
        let review = try #require(ContentTypeRegistry().descriptor(id: "review"))
        #expect(review.projections.microformat == "h-review")
        #expect(review.projections.schemaType == "Review")
        #expect(review.projections.microformatProperties["rating"] == "p-rating")
        #expect(review.fields.first { $0.name == "rating" }?.kind == .number)
        #expect(review.fields.first { $0.name == "rating" }?.required == true)
    }

    @Test("Business Profile is an h-card / LocalBusiness singleton")
    func businessProfileType() throws {
        let profile = try #require(ContentTypeRegistry().descriptor(id: "businessProfile"))
        #expect(profile.storage == .singleton("profile"))
        #expect(profile.singletonSlot == "profile")
        #expect(profile.collection == nil)
        #expect(profile.projections.microformat == "h-card")
        #expect(profile.projections.schemaType == "LocalBusiness")
        #expect(profile.projections.microformatProperties["telephone"] == "p-tel")
    }

    @Test("Personal Profile is an h-card / Person singleton sharing the profile slot")
    func personalProfileType() throws {
        let profile = try #require(ContentTypeRegistry().descriptor(id: "personalProfile"))
        #expect(profile.storage == .singleton("profile"))
        #expect(profile.singletonSlot == "profile")
        #expect(profile.collection == nil)
        #expect(profile.projections.microformat == "h-card")
        #expect(profile.projections.schemaType == "Person")
        #expect(profile.projections.microformatProperties["email"] == "u-email")
        #expect(profile.fields.first?.name == "name")
        #expect(profile.fields.first?.required == true)
    }

    @Test("Resume is a singleton projecting h-resume + schema.org Person, with experience/education as objectArray")
    func resumeType() throws {
        let resume = try #require(ContentTypeRegistry().descriptor(id: "resume"))
        #expect(resume.storage == .singleton("resume"))
        #expect(resume.singletonSlot == "resume")
        #expect(resume.projections.microformat == "h-resume")
        #expect(resume.projections.schemaType == "Person")
        #expect(resume.projections.microformatProperties == [
            "name": "p-name",
            "summary": "p-summary",
            "skills": "p-skill",
        ])

        let name = try #require(resume.fields.first { $0.name == "name" })
        #expect(name.kind == .string)
        #expect(name.required)

        let summary = try #require(resume.fields.first { $0.name == "summary" })
        #expect(summary.kind == .text)
        #expect(summary.required)

        let experience = try #require(resume.fields.first { $0.name == "experience" })
        guard case .objectArray(let experienceFields) = experience.kind else {
            Issue.record("expected experience to be .objectArray")
            return
        }
        #expect(experienceFields.map(\.name) == ["title", "organization", "startDate", "endDate", "description"])
        #expect(experienceFields.filter(\.required).map(\.name) == ["title", "organization", "startDate"])

        let education = try #require(resume.fields.first { $0.name == "education" })
        guard case .objectArray(let educationFields) = education.kind else {
            Issue.record("expected education to be .objectArray")
            return
        }
        #expect(educationFields.map(\.name) == ["degree", "institution", "startDate", "endDate", "description"])
        #expect(educationFields.filter(\.required).map(\.name) == ["degree", "institution", "startDate"])

        let skills = try #require(resume.fields.first { $0.name == "skills" })
        #expect(skills.kind == .stringArray)
    }

    @Test("personalTypes include album and like in canonical order")
    func personalTypeOrder() {
        #expect(ContentTypeRegistry.personalTypes.map(\.id)
            == ["note", "article", "photo", "album", "bookmark", "reply", "like"])
    }

    @Test("album is an h-entry image gallery with an imageArray field")
    func albumDescriptor() {
        let album = try! #require(ContentTypeRegistry().descriptor(id: "album"))
        #expect(album.displayName == "Album")
        #expect(album.collection == "albums")
        #expect(album.projections.microformat == "h-entry")
        #expect(album.projections.schemaType == "ImageGallery")
        let images = try! #require(album.fields.first { $0.name == "images" })
        #expect(images.kind == .imageArray)
        #expect(images.required)
        #expect(album.projections.microformatProperties["images"] == "u-photo")
        #expect(album.projections.microformatProperties["title"] == "p-name")
        #expect(album.projections.microformatProperties["publishDate"] == "dt-published")
    }

    @Test("objectArray kind carries its ordered member fields and compares by value")
    func objectArrayKindCarriesMemberFields() {
        let memberFields = [
            ContentTypeField("title", .string, required: true),
            ContentTypeField("organization", .string, required: true),
            ContentTypeField("startDate", .date, required: true),
            ContentTypeField("endDate", .date),
            ContentTypeField("description", .text),
        ]
        let field = ContentTypeField("experience", .objectArray(fields: memberFields))
        guard case .objectArray(let fields) = field.kind else {
            Issue.record("expected .objectArray")
            return
        }
        #expect(fields.map(\.name) == ["title", "organization", "startDate", "endDate", "description"])
        #expect(fields.first?.kind == .string)
        #expect(fields.first?.required == true)

        // Equatable: same fields in the same order compare equal; a different order does not.
        let same = ContentTypeField("experience", .objectArray(fields: memberFields))
        #expect(field == same)
        let reordered = ContentTypeField("experience", .objectArray(fields: memberFields.reversed()))
        #expect(field != reordered)
    }

    @Test("like is an h-entry with u-like-of and no schema.org type")
    func likeDescriptor() {
        let like = try! #require(ContentTypeRegistry().descriptor(id: "like"))
        #expect(like.displayName == "Like")
        #expect(like.collection == "likes")
        #expect(like.projections.microformat == "h-entry")
        #expect(like.projections.schemaType == nil)
        let likeOf = try! #require(like.fields.first { $0.name == "likeOf" })
        #expect(likeOf.kind == .url)
        #expect(likeOf.required)
        #expect(like.projections.microformatProperties["likeOf"] == "u-like-of")
    }

    @Test("every post-family descriptor has a trailing draft field")
    func postFamilyHasDraft() {
        let registry = ContentTypeRegistry()
        for id in ["note", "article", "photo", "album", "bookmark", "reply", "like"] {
            let descriptor = try! #require(registry.descriptor(id: id))
            #expect(descriptor.fields.last?.name == "draft", "\(id): draft should be the last field")
            #expect(descriptor.fields.last?.kind == .bool, "\(id): draft should be .bool")
            #expect(descriptor.projections.microformatProperties["draft"] == nil,
                    "\(id): draft has no mf2 projection")
        }
    }

    @Test("note and article carry an optional, mf2-inert audience field (V-5.2a, #369)")
    func audienceFieldIsInert() {
        let registry = ContentTypeRegistry()
        for id in ["note", "article"] {
            let descriptor = try! #require(registry.descriptor(id: id))
            let audience = try! #require(descriptor.fields.first { $0.name == "audience" },
                                          "\(id): missing audience field")
            #expect(audience.kind == .url, "\(id): audience should be .url")
            #expect(!audience.required, "\(id): audience should be optional")
            #expect(descriptor.projections.microformatProperties["audience"] == nil,
                    "\(id): audience has no mf2 projection — federation only, per #369")
            #expect(descriptor.fields.last?.name == "draft",
                    "\(id): draft must stay the trailing field")
        }
    }

    // MARK: Reverse lookup

    @Test("descriptor(forCollection:) maps a collection name back to its type")
    func reverseLookupByCollection() {
        let r = ContentTypeRegistry.default
        #expect(r.descriptor(forCollection: "events")?.id == "event")
        #expect(r.descriptor(forCollection: "reviews")?.id == "review")
        #expect(r.descriptor(forCollection: "notes")?.id == "note")
        // Unknown / custom collection has no descriptor.
        #expect(r.descriptor(forCollection: "blog") == nil)
        // Page-stored businessProfile has no collection, so it is never reverse-matched.
        #expect(r.descriptor(forCollection: "") == nil)
    }

    @Test("collectionBackedTypeIDs lists exactly the .collection-stored built-ins, in order")
    func collectionBackedIDs() {
        #expect(ContentTypeRegistry.default.collectionBackedTypeIDs == [
            "note", "article", "photo", "album", "bookmark", "reply", "like",
            "announcement", "event", "review", "member",
        ])
    }

    // MARK: Catalog invariants

    @Test("every built-in has a unique id, a microformat, and reachable mf2 fields")
    func builtInInvariants() {
        let registry = ContentTypeRegistry()
        let ids = registry.ids
        #expect(Set(ids).count == ids.count)  // ids unique

        for descriptor in registry.all {
            #expect(!descriptor.displayName.isEmpty)
            #expect(descriptor.projections.microformat.hasPrefix("h-"))
            // Every field referenced by an mf2 mapping must exist on the type.
            let fieldNames = Set(descriptor.fields.map(\.name))
            for mappedField in descriptor.projections.microformatProperties.keys {
                #expect(fieldNames.contains(mappedField),
                        "\(descriptor.id): mf2 maps unknown field '\(mappedField)'")
            }
            // A collection type must carry a non-empty collection name.
            if case let .collection(name) = descriptor.storage {
                #expect(!name.isEmpty)
                #expect(descriptor.collection == name)
            }
        }
    }

    // MARK: rawMf2Property reverse lookup

    @Test("rawMf2Property strips the mf2 prefix class from a field's microformat mapping")
    func rawMf2PropertyStripsPrefix() {
        let article = ContentTypeRegistry.article
        #expect(article.projections.rawMf2Property(forField: "body") == "content")        // e-content
        #expect(article.projections.rawMf2Property(forField: "publishDate") == "published") // dt-published
        #expect(article.projections.rawMf2Property(forField: "tags") == "category")        // p-category
    }

    @Test("rawMf2Property handles the u- prefix")
    func rawMf2PropertyHandlesUPrefix() {
        let bookmark = ContentTypeRegistry.bookmark
        #expect(bookmark.projections.rawMf2Property(forField: "bookmarkOf") == "bookmark-of") // u-bookmark-of
    }

    @Test("rawMf2Property returns nil for a field with no mf2 mapping")
    func rawMf2PropertyNilForUnmappedField() {
        let article = ContentTypeRegistry.article
        #expect(article.projections.rawMf2Property(forField: "draft") == nil)
        #expect(article.projections.rawMf2Property(forField: "nonexistent") == nil)
    }

    @Test("titleField finds the type's human-facing title field, or nil")
    func titleFieldPerType() throws {
        let registry = ContentTypeRegistry()
        let bookmark = try #require(registry.descriptor(id: "bookmark"))
        let event = try #require(registry.descriptor(id: "event"))
        let review = try #require(registry.descriptor(id: "review"))
        let reply = try #require(registry.descriptor(id: "reply"))
        let like = try #require(registry.descriptor(id: "like"))

        #expect(bookmark.titleField?.name == "title")
        #expect(event.titleField?.name == "name")
        #expect(review.titleField?.name == "itemReviewed")
        // reply and like are identified by their target URL, not by a name (#916).
        #expect(reply.titleField == nil)
        #expect(like.titleField == nil)
    }

    @Test("titleIsRequired reflects the title field's own required-ness, not just its presence (#1011)")
    func titleIsRequiredPerType() throws {
        let registry = ContentTypeRegistry()
        let article = try #require(registry.descriptor(id: "article"))
        let bookmark = try #require(registry.descriptor(id: "bookmark"))
        let event = try #require(registry.descriptor(id: "event"))
        let review = try #require(registry.descriptor(id: "review"))
        let reply = try #require(registry.descriptor(id: "reply"))
        let like = try #require(registry.descriptor(id: "like"))

        #expect(article.titleIsRequired)   // title: z.string()
        #expect(event.titleIsRequired)     // name: z.string()
        #expect(review.titleIsRequired)    // itemReviewed: z.string()
        // bookmark's title is z.string().optional() — present, but not required (#1011).
        #expect(!bookmark.titleIsRequired)
        // reply and like have no title-like field at all, so there is nothing to require.
        #expect(!reply.titleIsRequired)
        #expect(!like.titleIsRequired)
    }

    @Test("requiredURLFields lists required .url fields in declaration order")
    func requiredURLFieldsPerType() throws {
        let registry = ContentTypeRegistry()
        let bookmark = try #require(registry.descriptor(id: "bookmark"))
        let reply = try #require(registry.descriptor(id: "reply"))
        let like = try #require(registry.descriptor(id: "like"))
        let note = try #require(registry.descriptor(id: "note"))

        #expect(bookmark.requiredURLFields.map(\.name) == ["bookmarkOf"])
        #expect(reply.requiredURLFields.map(\.name) == ["inReplyTo"])
        #expect(like.requiredURLFields.map(\.name) == ["likeOf"])
        // `audience` is an optional .url, so it must not appear here.
        #expect(note.requiredURLFields.isEmpty)
    }
}
