# Release Pipeline

Anglesite ships through the Mac App Store only.

The single app target is `Anglesite` with bundle id `io.dwk.anglesite`. It is
sandboxed, uses App Store signing, and gets updates from App Store Connect. There
is no direct-download update feed, GitHub Release artifact, or notarized zip path.

## One-Time Setup

1. **App Store Connect app record.** Create an app for bundle id
   `io.dwk.anglesite` in [App Store Connect](https://appstoreconnect.apple.com/).
   The build will not upload until the record exists.

2. **Certificates.** In the Apple Developer portal, create and install in your
   login keychain:
   - an **Apple Distribution** certificate, which signs the `.app`;
   - a **Mac Installer Distribution** certificate, which signs the outer `.pkg`.

   Also install the **Apple WWDR** intermediate from
   <https://www.apple.com/certificateauthority/>. `scripts/release.sh`
   preflights these and fails early if any are missing.

3. **Provisioning profile.** Create a **Mac App Store** provisioning profile for
   `io.dwk.anglesite` tied to the Apple Distribution cert, download it, and
   install it. Note its name; pass it as `PROVISIONING_PROFILE`.

4. **Virtualization entitlement — nothing to request.** The app entitlement file
   includes `com.apple.security.virtualization` for Apple Containerization. It is an
   unrestricted entitlement: it is not a portal capability, needs no Apple approval,
   and is honored under any signature (even ad-hoc Debug builds boot containers —
   verified 2026-07-07). A standard Mac App Store profile suffices; confirm upload
   validation accepts it with `scripts/release.sh --validate-only` (precedent: the
   sandboxed `try-containers/Containers` app ships it on the Mac App Store).

5. **App Store Connect API key.** In App Store Connect -> Users and Access ->
   Integrations -> App Store Connect API, create a key with the App Manager role.
   Put the `.p8` in `~/.appstoreconnect/private_keys/` or `~/.private_keys/`, and
   record the Key ID and Issuer ID.

## Per-Release Flow

Bump `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in `project.yml` if needed,
then run:

```sh
TEAM_ID=YOUR_TEAM_ID \
PROVISIONING_PROFILE="Anglesite App Store" \
ASC_API_KEY_ID=XXXXXXXXXX \
ASC_API_ISSUER_ID=00000000-0000-0000-0000-000000000000 \
  scripts/release.sh
```

The script:

1. runs `xcodegen generate`;
2. archives the `Anglesite` scheme;
3. verifies the archived app signature and Team ID;
4. exports, and unless `--validate-only` uploads, an App Store `.pkg` via
   `xcodebuild -exportArchive`.

Use `--validate-only` to archive/export/validate without uploading. Transporter
is still a valid manual fallback: drop the exported `.pkg` onto Transporter.app.

## TestFlight Beta Distribution

TestFlight builds go through the exact same pipeline as a full release --
`scripts/release.sh` archives, signs, and uploads to App Store Connect, and
that upload *is* the TestFlight build-upload path. There is no separate
"upload for beta" step. What's specific to TestFlight is App Store
Connect configuration (mostly manual) and setting the build's "What to
Test" notes (scripted).

### One-time setup (manual, in App Store Connect)

1. **TestFlight tab.** Nothing to create separately -- it appears
   automatically on the app record from step 1 of "One-Time Setup" above,
   once the first build is uploaded and finishes processing.
2. **Export compliance.** `Resources/Info.plist` declares
   `ITSAppUsesNonExemptEncryption=false` (accurate -- Anglesite only uses
   standard HTTPS/TLS via system frameworks, no custom cryptography). This
   skips App Store Connect's manual export-compliance prompt, which
   otherwise blocks a build from being distributed to any tester group
   until answered.
3. **Internal Testing group.** App Store Connect -> TestFlight -> Internal
   Testing -> create a group, add testers by Apple ID (they must already
   have a role on the App Store Connect team), then add a processed build
   to the group. No Beta App Review required -- builds are available to
   internal testers immediately.
4. **External Testing group -- when to open one.** Left as a deliberate
   judgment call, not automated here: open an External Testing group once
   internal testers have validated a build and you want feedback from
   people outside the Apple Developer team. The first build submitted to
   an external group needs Beta App Review (typically faster and lighter
   than full App Store review); most builds after that, without
   significant changes, don't need re-review.
5. **Virtualization entitlement.** Already confirmed in "One-Time Setup"
   step 4 above -- the same `scripts/release.sh --validate-only` check
   covers TestFlight builds, since they go through the identical export
   pipeline.

### Beta release flow

```sh
# 1. Archive, sign, and upload -- same as a full release.
TEAM_ID=YOUR_TEAM_ID \
PROVISIONING_PROFILE="Anglesite App Store" \
ASC_API_KEY_ID=XXXXXXXXXX \
ASC_API_ISSUER_ID=00000000-0000-0000-0000-000000000000 \
  scripts/release.sh

# 2. Wait until the build appears under TestFlight -> Builds in App Store
#    Connect, then run step 3 below (it polls while the build finishes
#    processing, but won't wait for the build to first appear).

# 3. Set the "What to Test" notes for testers.
ASC_API_KEY_ID=XXXXXXXXXX \
ASC_API_ISSUER_ID=00000000-0000-0000-0000-000000000000 \
  scripts/testflight-notes.sh --notes "Try the new site importer and report crashes."
```

Then add the build to a tester group (Internal or External) in App Store
Connect -- see "One-time setup" above.

See [#617](https://github.com/Anglesite/Anglesite/issues/617) for the
separate v1.0 App Store submission track, which shares this same
archive/export/upload pipeline but goes through full App Review instead
of TestFlight's Beta App Review.
