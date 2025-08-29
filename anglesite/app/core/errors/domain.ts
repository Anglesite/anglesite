/**
 * @file Domain-specific error classes for Anglesite.
 *
 * Contains specialized error classes for different domains within Anglesite,.
 * including website management, server operations, DNS, certificates, and more.
 */

import {
  AngleError,
  SystemError,
  NetworkError,
  FileSystemError,
  ValidationError,
  BusinessLogicError,
  ErrorSeverity,
  ErrorCategory,
  ErrorMetadata,
} from './base';

// ===== WEBSITE MANAGEMENT ERRORS =====

/**
 * Website-related errors.
 */
export class WebsiteError extends BusinessLogicError {
  public readonly websiteId?: string;
  public readonly websitePath?: string;

  constructor(
    message: string,
    code: string,
    websiteId?: string,
    websitePath?: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      message,
      code,
      severity,
      {
        ...metadata,
        websiteId,
        resource: websitePath,
        context: {
          ...metadata.context,
          websiteId,
          websitePath,
        },
      },
      cause
    );

    this.websiteId = websiteId;
    this.websitePath = websitePath;
  }
}

export class WebsiteNotFoundError extends WebsiteError {
  constructor(websiteId: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Website not found: ${websiteId}`,
      'WEBSITE_NOT_FOUND',
      websiteId,
      undefined,
      ErrorSeverity.MEDIUM,
      metadata,
      cause
    );
  }
}

export class WebsiteCreationError extends WebsiteError {
  constructor(websitePath: string, reason: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Failed to create website at ${websitePath}: ${reason}`,
      'WEBSITE_CREATION_FAILED',
      undefined,
      websitePath,
      ErrorSeverity.HIGH,
      metadata,
      cause
    );
  }
}

export class WebsiteDeletionError extends WebsiteError {
  constructor(websiteId: string, reason: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Failed to delete website ${websiteId}: ${reason}`,
      'WEBSITE_DELETION_FAILED',
      websiteId,
      undefined,
      ErrorSeverity.HIGH,
      metadata,
      cause
    );
  }
}

export class WebsiteConfigurationError extends WebsiteError {
  constructor(websiteId: string, configKey: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Invalid configuration for website ${websiteId}: ${configKey}`,
      'WEBSITE_CONFIG_INVALID',
      websiteId,
      undefined,
      ErrorSeverity.MEDIUM,
      {
        ...metadata,
        context: {
          ...metadata.context,
          configKey,
        },
      },
      cause
    );
  }
}

// ===== SERVER MANAGEMENT ERRORS =====

/**
 * Server-related errors.
 */
export class ServerError extends SystemError {
  public readonly port?: number;
  public readonly serverId?: string;

  constructor(
    message: string,
    code: string,
    port?: number,
    serverId?: string,
    severity: ErrorSeverity = ErrorSeverity.HIGH,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      message,
      code,
      severity,
      {
        ...metadata,
        context: {
          ...metadata.context,
          port,
          serverId,
        },
      },
      cause
    );

    this.port = port;
    this.serverId = serverId;
  }
}

export class ServerStartError extends ServerError {
  constructor(port: number, reason: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Failed to start server on port ${port}: ${reason}`,
      'SERVER_START_FAILED',
      port,
      undefined,
      ErrorSeverity.HIGH,
      metadata,
      cause
    );
  }
}

export class ServerStopError extends ServerError {
  constructor(serverId: string, reason: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Failed to stop server ${serverId}: ${reason}`,
      'SERVER_STOP_FAILED',
      undefined,
      serverId,
      ErrorSeverity.MEDIUM,
      metadata,
      cause
    );
  }
}

export class PortAlreadyInUseError extends ServerError {
  constructor(port: number, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(`Port ${port} is already in use`, 'PORT_IN_USE', port, undefined, ErrorSeverity.MEDIUM, metadata, cause);
  }
}

// ===== DNS MANAGEMENT ERRORS =====

/**
 * DNS-related errors.
 */
export class DnsError extends NetworkError {
  public readonly domain?: string;
  public readonly recordType?: string;

  constructor(
    message: string,
    code: string,
    domain?: string,
    recordType?: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      message,
      code,
      severity,
      {
        ...metadata,
        context: {
          ...metadata.context,
          domain,
          recordType,
        },
      },
      cause
    );

    this.domain = domain;
    this.recordType = recordType;
  }
}

export class DnsResolutionError extends DnsError {
  constructor(domain: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Failed to resolve domain: ${domain}`,
      'DNS_RESOLUTION_FAILED',
      domain,
      undefined,
      ErrorSeverity.MEDIUM,
      metadata,
      cause
    );
  }
}

export class DnsRecordUpdateError extends DnsError {
  constructor(domain: string, recordType: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Failed to update ${recordType} record for ${domain}`,
      'DNS_RECORD_UPDATE_FAILED',
      domain,
      recordType,
      ErrorSeverity.HIGH,
      metadata,
      cause
    );
  }
}

export class HostsFileError extends DnsError {
  constructor(reason: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Hosts file operation failed: ${reason}`,
      'HOSTS_FILE_ERROR',
      undefined,
      undefined,
      ErrorSeverity.HIGH,
      metadata,
      cause
    );
  }
}

// ===== CERTIFICATE MANAGEMENT ERRORS =====

/**
 * Certificate-related errors.
 */
export class CertificateError extends SystemError {
  public readonly domain?: string;
  public readonly certificatePath?: string;

  constructor(
    message: string,
    code: string,
    domain?: string,
    certificatePath?: string,
    severity: ErrorSeverity = ErrorSeverity.HIGH,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      message,
      code,
      severity,
      {
        ...metadata,
        resource: certificatePath,
        context: {
          ...metadata.context,
          domain,
          certificatePath,
        },
      },
      cause
    );

    this.domain = domain;
    this.certificatePath = certificatePath;
  }
}

export class CertificateGenerationError extends CertificateError {
  constructor(domain: string, reason: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Failed to generate certificate for ${domain}: ${reason}`,
      'CERTIFICATE_GENERATION_FAILED',
      domain,
      undefined,
      ErrorSeverity.HIGH,
      metadata,
      cause
    );
  }
}

export class CertificateValidationError extends CertificateError {
  constructor(certificatePath: string, reason: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Certificate validation failed: ${reason}`,
      'CERTIFICATE_VALIDATION_FAILED',
      undefined,
      certificatePath,
      ErrorSeverity.HIGH,
      metadata,
      cause
    );
  }
}

export class CertificateExpiredError extends CertificateError {
  public readonly expirationDate: Date;

  constructor(domain: string, expirationDate: Date, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Certificate for ${domain} expired on ${expirationDate.toISOString()}`,
      'CERTIFICATE_EXPIRED',
      domain,
      undefined,
      ErrorSeverity.HIGH,
      {
        ...metadata,
        context: {
          ...metadata.context,
          expirationDate: expirationDate.toISOString(),
        },
      },
      cause
    );

    this.expirationDate = expirationDate;
  }
}

// ===== ATOMIC OPERATION ERRORS =====

/**
 * Atomic operation-related errors.
 */
export class AtomicOperationError extends AngleError {
  public readonly operationType?: string;
  public readonly rollbackPerformed?: boolean;
  public readonly temporaryPaths?: string[];

  constructor(
    message: string,
    code: string,
    operationType?: string,
    rollbackPerformed?: boolean,
    temporaryPaths?: string[],
    severity: ErrorSeverity = ErrorSeverity.HIGH,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      message,
      code,
      ErrorCategory.ATOMIC_OPERATION,
      severity,
      {
        ...metadata,
        context: {
          ...metadata.context,
          operationType,
          rollbackPerformed,
          temporaryPaths,
        },
      },
      cause
    );

    this.operationType = operationType;
    this.rollbackPerformed = rollbackPerformed;
    this.temporaryPaths = temporaryPaths;
  }
}

export class AtomicWriteError extends AtomicOperationError {
  constructor(filePath: string, reason: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Atomic write failed for ${filePath}: ${reason}`,
      'ATOMIC_WRITE_FAILED',
      'write',
      false,
      undefined,
      ErrorSeverity.HIGH,
      {
        ...metadata,
        resource: filePath,
      },
      cause
    );
  }
}

export class AtomicCopyError extends AtomicOperationError {
  constructor(
    sourcePath: string,
    targetPath: string,
    reason: string,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      `Atomic copy failed from ${sourcePath} to ${targetPath}: ${reason}`,
      'ATOMIC_COPY_FAILED',
      'copy',
      false,
      undefined,
      ErrorSeverity.HIGH,
      {
        ...metadata,
        context: {
          ...metadata.context,
          sourcePath,
          targetPath,
        },
      },
      cause
    );
  }
}

export class RollbackError extends AtomicOperationError {
  constructor(operationType: string, reason: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Rollback failed for ${operationType} operation: ${reason}`,
      'ROLLBACK_FAILED',
      operationType,
      false,
      undefined,
      ErrorSeverity.CRITICAL,
      metadata,
      cause
    );
  }
}

// ===== TEMPLATE AND UI ERRORS =====

/**
 * Template loading and UI errors.
 */
export class TemplateError extends BusinessLogicError {
  public readonly templatePath?: string;

  constructor(
    message: string,
    code: string,
    templatePath?: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      message,
      code,
      severity,
      {
        ...metadata,
        resource: templatePath,
        context: {
          ...metadata.context,
          templatePath,
        },
      },
      cause
    );

    this.templatePath = templatePath;
  }
}

export class TemplateNotFoundError extends TemplateError {
  constructor(templatePath: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Template not found: ${templatePath}`,
      'TEMPLATE_NOT_FOUND',
      templatePath,
      ErrorSeverity.HIGH,
      metadata,
      cause
    );
  }
}

export class TemplateParsingError extends TemplateError {
  constructor(templatePath: string, reason: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Template parsing failed for ${templatePath}: ${reason}`,
      'TEMPLATE_PARSING_FAILED',
      templatePath,
      ErrorSeverity.HIGH,
      metadata,
      cause
    );
  }
}

// ===== WINDOW MANAGEMENT ERRORS =====

/**
 * Window management errors.
 */
export class WindowError extends SystemError {
  public readonly windowId?: string;
  public readonly windowType?: string;

  constructor(
    message: string,
    code: string,
    windowId?: string,
    windowType?: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      message,
      code,
      severity,
      {
        ...metadata,
        context: {
          ...metadata.context,
          windowId,
          windowType,
        },
      },
      cause
    );

    this.windowId = windowId;
    this.windowType = windowType;
  }
}

export class WindowCreationError extends WindowError {
  constructor(windowType: string, reason: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Failed to create ${windowType} window: ${reason}`,
      'WINDOW_CREATION_FAILED',
      undefined,
      windowType,
      ErrorSeverity.HIGH,
      metadata,
      cause
    );
  }
}

export class WindowNotFoundError extends WindowError {
  constructor(windowId: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Window not found: ${windowId}`,
      'WINDOW_NOT_FOUND',
      windowId,
      undefined,
      ErrorSeverity.MEDIUM,
      metadata,
      cause
    );
  }
}

// ===== FILE SYSTEM SPECIFIC ERRORS =====

/**
 * Specific file system errors.
 */
export class FileNotFoundError extends FileSystemError {
  constructor(path: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(`File not found: ${path}`, 'FILE_NOT_FOUND', path, ErrorSeverity.MEDIUM, metadata, cause);
  }
}

export class DirectoryNotFoundError extends FileSystemError {
  constructor(path: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(`Directory not found: ${path}`, 'DIRECTORY_NOT_FOUND', path, ErrorSeverity.MEDIUM, metadata, cause);
  }
}

export class PermissionDeniedError extends FileSystemError {
  constructor(path: string, operation: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Permission denied for ${operation} on ${path}`,
      'PERMISSION_DENIED',
      path,
      ErrorSeverity.HIGH,
      {
        ...metadata,
        context: {
          ...metadata.context,
          operation,
        },
      },
      cause
    );
  }
}

export class DiskSpaceError extends FileSystemError {
  constructor(path: string, requiredSpace?: number, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Insufficient disk space for operation on ${path}${requiredSpace ? ` (required: ${requiredSpace} bytes)` : ''}`,
      'INSUFFICIENT_DISK_SPACE',
      path,
      ErrorSeverity.HIGH,
      {
        ...metadata,
        context: {
          ...metadata.context,
          requiredSpace,
        },
      },
      cause
    );
  }
}

// ===== VALIDATION SPECIFIC ERRORS =====

/**
 * Specific validation errors.
 */
export class RequiredFieldError extends ValidationError {
  constructor(field: string, metadata: Partial<ErrorMetadata> = {}, cause?: Error) {
    super(
      `Required field missing: ${field}`,
      'REQUIRED_FIELD_MISSING',
      field,
      undefined,
      ErrorSeverity.MEDIUM,
      metadata,
      cause
    );
  }
}

export class InvalidFormatError extends ValidationError {
  constructor(
    field: string,
    value: unknown,
    expectedFormat: string,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      `Invalid format for ${field}: expected ${expectedFormat}`,
      'INVALID_FORMAT',
      field,
      value,
      ErrorSeverity.MEDIUM,
      {
        ...metadata,
        context: {
          ...metadata.context,
          expectedFormat,
        },
      },
      cause
    );
  }
}

export class ValueOutOfRangeError extends ValidationError {
  constructor(
    field: string,
    value: unknown,
    min?: number,
    max?: number,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      `Value out of range for ${field}: ${value} (min: ${min}, max: ${max})`,
      'VALUE_OUT_OF_RANGE',
      field,
      value,
      ErrorSeverity.MEDIUM,
      {
        ...metadata,
        context: {
          ...metadata.context,
          min,
          max,
        },
      },
      cause
    );
  }
}
