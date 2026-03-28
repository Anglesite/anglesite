/**
 * OG image template definitions for Satori rendering.
 *
 * Each template returns a Satori-compatible element tree (plain objects).
 * These are pure functions with no side effects — easy to test without Satori.
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface OgColors {
  primary: string;
  bg: string;
  text: string;
}

interface SatoriElement {
  type: string;
  props: {
    style?: Record<string, unknown>;
    src?: string;
    children?: (SatoriElement | string)[];
    [key: string]: unknown;
  };
}

/**
 * Text-only OG template: page title + site name on a branded background.
 */
export function textOnlyTemplate(
  title: string,
  siteName: string,
  colors: OgColors,
): SatoriElement {
  return {
    type: "div",
    props: {
      style: {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        backgroundColor: colors.primary,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              color: colors.bg,
              fontSize: 64,
              fontWeight: 700,
              textAlign: "center",
              lineHeight: 1.2,
              maxWidth: OG_WIDTH - 160,
              overflow: "hidden",
            },
            children: [title],
          },
        },
        {
          type: "div",
          props: {
            style: {
              color: colors.bg,
              fontSize: 28,
              fontWeight: 400,
              marginTop: 24,
              opacity: 0.85,
            },
            children: [siteName],
          },
        },
      ],
    },
  };
}

/**
 * Text + logo OG template: logo top-left, title centered, site name below.
 */
export function textLogoTemplate(
  title: string,
  siteName: string,
  colors: OgColors,
  logoSvg: string,
): SatoriElement {
  const logoDataUri = logoSvg
    ? `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`
    : "";

  const children: (SatoriElement | string)[] = [];

  // Logo in top-left corner (only if provided)
  if (logoDataUri) {
    children.push({
      type: "img",
      props: {
        src: logoDataUri,
        style: {
          width: 64,
          height: 64,
          position: "absolute",
          top: 40,
          left: 40,
        },
        width: 64,
        height: 64,
        children: [],
      },
    });
  }

  // Title centered
  children.push({
    type: "div",
    props: {
      style: {
        color: colors.bg,
        fontSize: 64,
        fontWeight: 700,
        textAlign: "center",
        lineHeight: 1.2,
        maxWidth: OG_WIDTH - 160,
        overflow: "hidden",
      },
      children: [title],
    },
  });

  // Site name below title
  children.push({
    type: "div",
    props: {
      style: {
        color: colors.bg,
        fontSize: 28,
        fontWeight: 400,
        marginTop: 24,
        opacity: 0.85,
      },
      children: [siteName],
    },
  });

  return {
    type: "div",
    props: {
      style: {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        backgroundColor: colors.primary,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
        position: "relative",
      },
      children,
    },
  };
}
