import AnglesiteSiteModel

/// Re-export of `AnglesiteSiteModel.AnglesitePackage` — the single source of truth for the
/// `.anglesite` package layout (#242) — so code that already imports AnglesiteCore reaches the
/// package model without a second import. A typealias rather than `@_exported import` keeps the
/// surface deliberate: only the symbols named here leak through.
public typealias AnglesitePackage = AnglesiteSiteModel.AnglesitePackage
/// Re-export of `AnglesiteSiteModel.ProjectValidator` (the "is this directory an Anglesite site?"
/// sentinel check), forwarded for the same single-import reason as ``AnglesitePackage``.
public typealias ProjectValidator = AnglesiteSiteModel.ProjectValidator
