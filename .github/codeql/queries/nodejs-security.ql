/**
 * @name Node.js Security Issues
 * @description Detects common security vulnerabilities in Node.js applications
 * @kind problem
 * @problem.severity warning
 * @security-severity 6.5
 * @precision high
 * @id dwk/nodejs-security
 * @tags security
 *       nodejs
 *       command-injection
 *       path-traversal
 */

import javascript

// Detect unsafe child_process usage
class UnsafeChildProcess extends CallExpr {
  UnsafeChildProcess() {
    exists(PropertyAccess pa |
      pa = this.getCallee() and
      pa.getPropertyName() = "exec" and
      pa.getBase().(Identifier).getName() = "child_process" and
      // Command contains user input (template literal or concatenation)
      (
        this.getArgument(0) instanceof TemplateLiteral or
        this.getArgument(0) instanceof AddExpr
      )
    )
  }
}

// Detect path traversal vulnerabilities
class PathTraversal extends CallExpr {
  PathTraversal() {
    exists(PropertyAccess pa |
      pa = this.getCallee() and
      (
        pa.getPropertyName() = "readFile" or
        pa.getPropertyName() = "readFileSync" or
        pa.getPropertyName() = "writeFile" or
        pa.getPropertyName() = "writeFileSync"
      ) and
      // File path contains user input without validation
      (
        this.getArgument(0) instanceof TemplateLiteral or
        (this.getArgument(0) instanceof AddExpr and
         not exists(CallExpr pathResolve |
           pathResolve.getCallee().(PropertyAccess).getPropertyName() = "resolve" and
           pathResolve.getCallee().(PropertyAccess).getBase().(Identifier).getName() = "path"
         ))
      )
    )
  }
}

// Detect unsafe eval usage
class UnsafeEval extends CallExpr {
  UnsafeEval() {
    this.getCallee().(Identifier).getName() = "eval" or
    exists(PropertyAccess pa |
      pa = this.getCallee() and
      pa.getPropertyName() = "runInThisContext" and
      pa.getBase().(Identifier).getName() = "vm"
    )
  }
}

// Detect unsafe JSON parsing
class UnsafeJsonParse extends CallExpr {
  UnsafeJsonParse() {
    exists(PropertyAccess pa |
      pa = this.getCallee() and
      pa.getPropertyName() = "parse" and
      pa.getBase().(Identifier).getName() = "JSON" and
      // No try-catch around JSON.parse
      not exists(TryStmt tryStmt |
        tryStmt.getBody().getAStmt*() = this.getEnclosingStmt()
      )
    )
  }
}

// Detect hardcoded secrets/credentials
class HardcodedSecret extends StringLiteral {
  HardcodedSecret() {
    exists(AssignExpr assign, string propName |
      assign.getRhs() = this and
      assign.getLhs().(PropertyAccess).getPropertyName() = propName and
      (
        propName.toLowerCase().matches("%password%") or
        propName.toLowerCase().matches("%secret%") or
        propName.toLowerCase().matches("%key%") or
        propName.toLowerCase().matches("%token%") or
        propName.toLowerCase().matches("%credential%")
      ) and
      this.getValue().length() > 8 and
      // Looks like a real secret (contains mixed case/numbers/symbols)
      exists(string val | val = this.getValue() |
        val.regexpMatch(".*[A-Z].*") and
        val.regexpMatch(".*[a-z].*") and 
        val.regexpMatch(".*[0-9].*")
      )
    )
  }
}

// Detect unsafe require() with dynamic input
class UnsafeDynamicRequire extends CallExpr {
  UnsafeDynamicRequire() {
    this.getCallee().(Identifier).getName() = "require" and
    (
      this.getArgument(0) instanceof TemplateLiteral or
      this.getArgument(0) instanceof AddExpr
    ) and
    // Not a webpack require.context
    not exists(PropertyAccess pa |
      pa = this.getCallee() and
      pa.getPropertyName() = "context"
    )
  }
}

// Detect unsafe buffer operations
class UnsafeBuffer extends CallExpr {
  UnsafeBuffer() {
    exists(PropertyAccess pa |
      pa = this.getCallee() and
      pa.getBase().(Identifier).getName() = "Buffer" and
      (
        // Buffer constructor with user input size
        pa.getPropertyName() = "alloc" and
        (this.getArgument(0) instanceof TemplateLiteral or this.getArgument(0) instanceof AddExpr) or
        // Unsafe Buffer.from without encoding
        pa.getPropertyName() = "from" and
        this.getNumArgument() < 2
      )
    )
  }
}

// Detect prototype pollution
class PrototypePollution extends AssignExpr {
  PrototypePollution() {
    exists(PropertyAccess pa |
      pa = this.getLhs() and
      (
        pa.getPropertyName() = "__proto__" or
        pa.getPropertyName() = "constructor" or
        pa.getPropertyName() = "prototype"
      )
    )
  }
}

// Detect unsafe RegExp with user input (ReDoS)
class UnsafeRegExp extends NewExpr {
  UnsafeRegExp() {
    this.getCallee().(Identifier).getName() = "RegExp" and
    (
      this.getArgument(0) instanceof TemplateLiteral or
      this.getArgument(0) instanceof AddExpr
    )
  }
}

// Query results
from AstNode node, string message, string recommendation
where
  (
    node instanceof UnsafeChildProcess and
    message = "Unsafe child_process.exec with user input detected" and
    recommendation = "Use child_process.execFile or spawn with array arguments, validate all input"
  ) or (
    node instanceof PathTraversal and
    message = "Potential path traversal vulnerability" and
    recommendation = "Use path.resolve() and validate that resolved path is within allowed directory"
  ) or (
    node instanceof UnsafeEval and
    message = "Unsafe eval usage detected" and
    recommendation = "Avoid eval(), use safer alternatives like JSON.parse or Function constructor with validation"
  ) or (
    node instanceof UnsafeJsonParse and
    message = "JSON.parse without error handling" and
    recommendation = "Wrap JSON.parse in try-catch block and validate input"
  ) or (
    node instanceof HardcodedSecret and
    message = "Potential hardcoded secret or credential" and
    recommendation = "Use environment variables or secure credential storage"
  ) or (
    node instanceof UnsafeDynamicRequire and
    message = "Dynamic require() with user input" and
    recommendation = "Validate module paths against allowlist, consider using import() with validation"
  ) or (
    node instanceof UnsafeBuffer and
    message = "Unsafe Buffer operation detected" and
    recommendation = "Validate buffer sizes and always specify encoding for Buffer.from()"
  ) or (
    node instanceof PrototypePollution and
    message = "Potential prototype pollution vulnerability" and
    recommendation = "Avoid modifying prototype properties, use Object.create(null) for safe objects"
  ) or (
    node instanceof UnsafeRegExp and
    message = "RegExp constructed with user input (ReDoS risk)" and
    recommendation = "Validate regex patterns, use timeout mechanisms, consider using regex libraries with DoS protection"
  )
select node, message + ". " + recommendation