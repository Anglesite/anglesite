import Testing
@testable import AnglesiteCore

@Suite struct PackageJSONDependenciesTests {
    static let fixture = """
    {
      "name": "anglesite-site",
      "type": "module",
      "version": "0.0.1",
      "dependencies": {
        "@astrojs/rss": "^4.0.0",
        "astro": "^5.0.0"
      },
      "devDependencies": {
        "typescript": "^5.9.3"
      }
    }
    """

    @Test func extractsBothDependencySections() throws {
        let deps = try PackageJSONDependencies.extract(from: Self.fixture)
        #expect(deps == ["@astrojs/rss": "^4.0.0", "astro": "^5.0.0", "typescript": "^5.9.3"])
    }

    @Test func throwsOnInvalidJSON() {
        #expect(throws: PackageJSONDependencies.ExtractionError.self) {
            _ = try PackageJSONDependencies.extract(from: "not json")
        }
    }

    @Test func extractsEmptyMapWhenNoDependencySectionsPresent() throws {
        let deps = try PackageJSONDependencies.extract(from: "{\"name\": \"x\"}")
        #expect(deps.isEmpty)
    }

    @Test func applyRewritesOnlyTheAcceptedPackagesRangeString() {
        let offers = [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")]
        let updated = PackageJSONDependencies.apply(offers, to: Self.fixture)
        #expect(updated.contains("\"astro\": \"^6.4.8\""))
        #expect(!updated.contains("\"astro\": \"^5.0.0\""))
        // Untouched: everything else, including formatting and the other dependency.
        #expect(updated.contains("\"@astrojs/rss\": \"^4.0.0\""))
        #expect(updated.contains("\"typescript\": \"^5.9.3\""))
        #expect(updated.contains("\"version\": \"0.0.1\""))
    }

    @Test func applyWithNoOffersReturnsTheTextUnchanged() {
        #expect(PackageJSONDependencies.apply([], to: Self.fixture) == Self.fixture)
    }

    @Test func applyIsSafeWhenThePackageNameIsNotPresent() {
        let offers = [DependencyUpdateOffer(name: "does-not-exist", currentRange: "^1.0.0", offeredRange: "^2.0.0")]
        #expect(PackageJSONDependencies.apply(offers, to: Self.fixture) == Self.fixture)
    }

    @Test func applyNeverTouchesAColldingTopLevelKeyOutsideTheDependencySections() {
        // "astro" collides with a script's *value* here, not just a key — apply
        // must only ever touch the quoted key `"astro":`, and only within the
        // dependencies/devDependencies spans, never inside "scripts".
        let textWithCollision = """
        {
          "name": "anglesite-site",
          "scripts": {
            "dev": "astro dev",
            "astro": "astro --help"
          },
          "dependencies": {
            "astro": "^5.0.0"
          }
        }
        """
        let offers = [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")]
        let updated = PackageJSONDependencies.apply(offers, to: textWithCollision)
        #expect(updated.contains("\"dependencies\": {\n    \"astro\": \"^6.4.8\"\n  }"))
        // The scripts section's "astro" key/value is completely untouched.
        #expect(updated.contains("\"astro\": \"astro --help\""))
        #expect(updated.contains("\"dev\": \"astro dev\""))
    }

    @Test func applyUpdatesAPackageNamePresentInBothSections() {
        let textWithBoth = """
        {
          "dependencies": {
            "shared-pkg": "^1.0.0"
          },
          "devDependencies": {
            "shared-pkg": "^1.0.0"
          }
        }
        """
        let offers = [DependencyUpdateOffer(name: "shared-pkg", currentRange: "^1.0.0", offeredRange: "^2.0.0")]
        let updated = PackageJSONDependencies.apply(offers, to: textWithBoth)
        let occurrences = updated.components(separatedBy: "\"shared-pkg\": \"^2.0.0\"").count - 1
        #expect(occurrences == 2)
        #expect(!updated.contains("^1.0.0"))
    }

    @Test func extractSectionsKeepsDependenciesAndDevDependenciesSeparate() throws {
        let sections = try PackageJSONDependencies.extractSections(from: Self.fixture)
        #expect(sections.dependencies == ["@astrojs/rss": "^4.0.0", "astro": "^5.0.0"])
        #expect(sections.devDependencies == ["typescript": "^5.9.3"])
    }

    @Test func extractSectionsThrowsOnInvalidJSON() {
        #expect(throws: PackageJSONDependencies.ExtractionError.self) {
            _ = try PackageJSONDependencies.extractSections(from: "not json")
        }
    }

    @Test func applyAdditionsInsertsANewEntryMatchingExistingIndentation() {
        let offers = [DependencyAdditionOffer(name: "astro-embed", offeredRange: "^0.13.0", section: .dependencies)]
        let updated = PackageJSONDependencies.applyAdditions(offers, to: Self.fixture)
        #expect(updated.contains("\"dependencies\": {\n    \"astro-embed\": \"^0.13.0\",\n    \"@astrojs/rss\": \"^4.0.0\",\n    \"astro\": \"^5.0.0\"\n  }"))
    }

    @Test func applyAdditionsTargetsTheDevDependenciesSectionWhenSpecified() {
        let offers = [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .devDependencies)]
        let updated = PackageJSONDependencies.applyAdditions(offers, to: Self.fixture)
        #expect(updated.contains("\"devDependencies\": {\n    \"html-validate\": \"^11.6.0\",\n    \"typescript\": \"^5.9.3\"\n  }"))
        // dependencies section untouched
        #expect(updated.contains("\"dependencies\": {\n    \"@astrojs/rss\": \"^4.0.0\",\n    \"astro\": \"^5.0.0\"\n  }"))
    }

    @Test func applyAdditionsUsesADefaultIndentForAnEmptySection() {
        let text = """
        {
          "dependencies": {}
        }
        """
        let offers = [DependencyAdditionOffer(name: "astro-embed", offeredRange: "^0.13.0", section: .dependencies)]
        let updated = PackageJSONDependencies.applyAdditions(offers, to: text)
        #expect(updated.contains("\"dependencies\": {\n  \"astro-embed\": \"^0.13.0\"\n}"))
    }

    @Test func applyAdditionsSkipsWhenTheTargetSectionIsAbsent() {
        let text = """
        {
          "name": "anglesite-site"
        }
        """
        let offers = [DependencyAdditionOffer(name: "astro-embed", offeredRange: "^0.13.0", section: .dependencies)]
        #expect(PackageJSONDependencies.applyAdditions(offers, to: text) == text)
    }

    @Test func applyAdditionsHandlesMultipleOffersToTheSameSection() {
        let text = """
        {
          "dependencies": {
            "astro": "^5.0.0"
          }
        }
        """
        let offers = [
            DependencyAdditionOffer(name: "astro-embed", offeredRange: "^0.13.0", section: .dependencies),
            DependencyAdditionOffer(name: "@tgwf/co2", offeredRange: "^0.19.0", section: .dependencies),
        ]
        let updated = PackageJSONDependencies.applyAdditions(offers, to: text)
        #expect(updated.contains("\"astro-embed\": \"^0.13.0\""))
        #expect(updated.contains("\"@tgwf/co2\": \"^0.19.0\""))
        #expect(updated.contains("\"astro\": \"^5.0.0\""))
    }

    @Test func applyAdditionsWithNoOffersReturnsTheTextUnchanged() {
        #expect(PackageJSONDependencies.applyAdditions([], to: Self.fixture) == Self.fixture)
    }

    @Test func applyAdditionsSkipsAnOfferWhoseNameAlreadyExistsInTheTargetSection() {
        // "astro" is already a key in `dependencies` in the fixture. Inserting it
        // again would produce two `"astro": ...` keys in the same JSON object —
        // parseable (last one wins) but semantically corrupted, and this function
        // is public so it must defend against a stale/duplicate offer regardless
        // of caller discipline (#1108 review).
        let offers = [DependencyAdditionOffer(name: "astro", offeredRange: "^99.0.0", section: .dependencies)]
        let updated = PackageJSONDependencies.applyAdditions(offers, to: Self.fixture)
        #expect(updated.components(separatedBy: "\"astro\"").count - 1 == 1)
        #expect(!updated.contains("^99.0.0"))
    }
}
