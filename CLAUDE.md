# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in the repositories in this folder. Each project has more specific information in its README.md and docs/ directory.

## Directory Contents

### 1. `anglesite/` - Electron-based Static Site Generator

A local-first, open-source WYSIWYG static site generator desktop application built with Electron and Eleventy. This makes heavy use of exising npm packages, including the sibling packages in this directory.

### 2. `anglesite-11ty/` - 11ty Plugin for Anglesite

Configuration required to run builds and previews in Anglesite. This is in a seperate NPM package to make managing starter templates for new websites trivial. Any Anglesite compatiple Eleventy Starter repo will use this configuration for compatibility.

### 3. `anglesite-starter/` - "blank" starter website for Anglesite projects

This is the "blank" starter for new Anglesite projects. Any new starter template will be API compatible with this package so Anglesite can use that as a starter.

Examples of website starter templates include:

- Blog
- Resturant
- Online Shop
- Local Newspaper
- ePub
- Political Canidate
- etc

### 4. `web-components/` - 11ty WebC Component Library

Reusable web components built with 11ty WebC templating for Anglesite websites. These are shared components that might be used in any starter template or website project.
