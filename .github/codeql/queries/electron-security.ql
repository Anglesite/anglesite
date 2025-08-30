/**
 * @name Electron Security Issues
 * @description Detects common security vulnerabilities in Electron applications
 * @kind problem
 * @problem.severity warning
 * @security-severity 7.0
 * @precision high
 * @id dwk/electron-security
 * @tags security
 *       electron
 *       main-process
 *       renderer-process
 */

import javascript

// Detect unsafe nodeIntegration usage
class UnsafeNodeIntegration extends CallExpr {
  UnsafeNodeIntegration() {
    exists(PropertyAccess pa |
      pa = this.getCallee() and
      pa.getPropertyName() = "nodeIntegration" and
      this.getArgument(0).(BooleanLiteral).getValue() = "true"
    )
  }
}

// Detect missing context isolation
class MissingContextIsolation extends CallExpr {
  MissingContextIsolation() {
    exists(ObjectExpr webPrefs |
      this.getAnArgument() = webPrefs and
      webPrefs.hasPropertyWrite("webSecurity", any(BooleanLiteral b | b.getValue() = "false")) and
      not webPrefs.hasPropertyWrite("contextIsolation", any(BooleanLiteral b | b.getValue() = "true"))
    )
  }
}

// Detect unsafe shell.openExternal usage
class UnsafeShellOpen extends CallExpr {
  UnsafeShellOpen() {
    exists(PropertyAccess pa |
      pa = this.getCallee() and
      pa.getPropertyName() = "openExternal" and
      pa.getBase().getUnderlyingValue().(Identifier).getName() = "shell" and
      not exists(this.getArgument(1))  // Missing options parameter
    )
  }
}

// Detect remote module usage (deprecated and unsafe)
class RemoteModuleUsage extends ImportDeclaration {
  RemoteModuleUsage() {
    this.getImportedPath().getValue() = "@electron/remote" or
    this.getImportedPath().getValue().matches("%remote%")
  }
}

// Detect unsafe preload script patterns
class UnsafePreloadScript extends CallExpr {
  UnsafePreloadScript() {
    exists(PropertyAccess pa, StringLiteral preloadPath |
      pa = this.getCallee() and
      pa.getPropertyName() = "preload" and
      preloadPath = this.getArgument(0) and
      (
        // Absolute paths are unsafe
        preloadPath.getValue().matches("/%") or
        // Relative paths without path.join are unsafe
        (preloadPath.getValue().matches("%../%") and 
         not exists(CallExpr pathJoin | 
           pathJoin.getCallee().(PropertyAccess).getPropertyName() = "join" and
           pathJoin.getCallee().(PropertyAccess).getBase().(Identifier).getName() = "path"
         ))
      )
    )
  }
}

// Detect unsafe IPC usage
class UnsafeIpcUsage extends CallExpr {
  UnsafeIpcUsage() {
    exists(PropertyAccess pa |
      pa = this.getCallee() and
      pa.getPropertyName() = "handle" and
      pa.getBase().(PropertyAccess).getPropertyName() = "ipcMain" and
      // Channel name should not contain user input patterns
      this.getArgument(0).(StringLiteral).getValue().matches("%${%") 
    )
  }
}

// Query results
from CallExpr call, string message, string recommendation
where
  (
    call instanceof UnsafeNodeIntegration and
    message = "Unsafe nodeIntegration enabled" and
    recommendation = "Disable nodeIntegration and use contextIsolation with preload scripts"
  ) or (
    call instanceof MissingContextIsolation and
    message = "Missing contextIsolation when webSecurity is disabled" and  
    recommendation = "Enable contextIsolation: true when disabling webSecurity"
  ) or (
    call instanceof UnsafeShellOpen and
    message = "shell.openExternal called without safety options" and
    recommendation = "Validate URLs and use options parameter with protocol restrictions"
  ) or (
    call instanceof UnsafePreloadScript and
    message = "Unsafe preload script path detected" and
    recommendation = "Use path.join(__dirname, 'preload.js') for secure preload paths"
  ) or (
    call instanceof UnsafeIpcUsage and
    message = "IPC channel name contains potential user input" and
    recommendation = "Use static channel names, validate input in IPC handlers"
  ) or (
    exists(RemoteModuleUsage remote |
      call = remote and
      message = "Deprecated @electron/remote module usage detected" and
      recommendation = "Use contextBridge API instead of remote module"
    )
  )
select call, message + ". " + recommendation