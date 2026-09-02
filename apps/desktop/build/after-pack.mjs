// electron-builder `afterPack` hook: flips the Electron fuses required by the security
// checklist in docs/spec/07-architecture.md §4. This has to run against the packaged
// binary — fuses are baked into the Electron executable itself, not something the app can
// set at runtime.
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses'

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context
  // `packager.executableName` only exists on `LinuxPackager` (app-builder-lib's own
  // `getElectronDestinationPath` branches the same way) — everywhere else, including
  // win32, the packaged binary is named after `appInfo.productFilename` (the
  // `executableName` build config, falling back to the sanitized product name).
  const executableName =
    electronPlatformName === 'linux' ? packager.executableName : packager.appInfo.productFilename

  const executablePath =
    electronPlatformName === 'darwin'
      ? `${appOutDir}/${executableName}.app/Contents/MacOS/${executableName}`
      : electronPlatformName === 'win32'
        ? `${appOutDir}/${executableName}.exe`
        : `${appOutDir}/${executableName}`

  await flipFuses(executablePath, {
    version: FuseVersion.V1,
    // Nothing in Retenia ever needs `electron --require`/`ELECTRON_RUN_AS_NODE`, and both
    // are a sandbox escape if left on.
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // Required for `asar: true` to actually mean something: without these, a copy of the
    // app with a tampered or unpacked asar still runs.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // Cookie encryption at rest; no reason to opt out of it.
    [FuseV1Options.EnableCookieEncryption]: true,
    // Retenia never loads a renderer over `file://` — the whole point of `app://`
    // (apps/desktop/src/main/protocol/app-protocol.ts) is that the renderer does not get
    // the ambient reach `file://` origins have by default. This fuse defaults to enabled;
    // turning it off removes that reach from any `file://` page a future feature (a PDF/EPUB
    // preview, an imported HTML asset) might ever load into a window.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  })
}
