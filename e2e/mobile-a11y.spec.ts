import { test, expect, type Page } from "@playwright/test";

import { CITATION, answerStream, stubAsk } from "./support";

/**
 * The MVP mobile + accessibility bar (issue #138), on the surfaces this suite
 * can reach.
 *
 * What is NOT here: the history sheet. History only mounts for a signed-in
 * session, and this config runs with `SUPABASE_URL` pinned empty (no database,
 * no sign-in). Since #161 the sheet's open/select/dismiss behavior at this
 * viewport lives in `e2e/history-mobile.local.spec.ts`, which runs against a
 * real local Supabase and a real signed-in session; the jsdom interaction
 * tests in `src/components/history/history-shell.test.tsx` still cover the
 * same paths without a browser. Requirement 3 — the owner's pass on a real
 * mobile Safari — is not something any automated suite here stands in for.
 */

const PHONE = { width: 375, height: 667 };
/** 375px at 200% zoom reflows to ~188px CSS; 320 is the WCAG 1.4.10 floor. */
const REFLOW = { width: 320, height: 512 };

/** Nothing may push the document wider than the viewport (WCAG 1.4.10). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
}

/** A long unbroken token and a table — the two things that blow out a column. */
const AWKWARD_ANSWER = answerStream(
  "Debe inscribirse en https://www.hacienda.go.cr/atv/ATV/frmDeclaracionesInscripcionModificacionDesinscripcion.aspx ",
  "\n\n| Formulario | Plazo |\n| --- | --- |\n| D-140 | 10 días hábiles desde el inicio de actividades |\n",
);

test.describe("phone viewport", () => {
  test.use({ viewport: PHONE });

  test("the landing fits the screen and declares viewport-fit=cover", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "¿Qué trámite le quita el sueño?" }),
    ).toBeVisible();
    await expect(page.getByLabel("Su pregunta")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // Safe-area insets only resolve to anything under `viewport-fit=cover`;
    // without it the padding on the header and the composer is inert on a
    // notched device.
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );
  });

  test("the composer is operable from the keyboard alone", async ({ page }) => {
    await stubAsk(page, answerStream("El plazo es de ", "10 días hábiles."));
    await page.goto("/");

    const composer = page.getByLabel("Su pregunta");
    await composer.focus();
    await page.keyboard.type("¿Cuál es el plazo del D-140?");
    await page.keyboard.press("Enter");

    await expect(page.getByText("El plazo es de")).toBeVisible();
    // Focus stays somewhere reachable — never lost to `<body>`, which strands
    // a keyboard user at the top of the document.
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
      "BODY",
    );
  });

  test("a long URL and a table stay inside the column", async ({ page }) => {
    await stubAsk(page, AWKWARD_ANSWER);
    await page.goto("/");
    await page.getByLabel("Su pregunta").fill("¿Cómo me inscribo en Hacienda?");
    await page.getByRole("button", { name: "Enviar" }).click();

    await expect(page.getByRole("table")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("reflow at 200% zoom", () => {
  test.use({ viewport: REFLOW });

  test("the empty state and an answer both fit 320px", async ({ page }) => {
    await stubAsk(page, AWKWARD_ANSWER);
    await page.goto("/");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.getByLabel("Su pregunta").fill("¿Cómo me inscribo?");
    await page.getByRole("button", { name: "Enviar" }).click();

    await expect(
      page.getByRole("link", { name: /Reglamento IVA/ }),
    ).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  // The third long-content case from the issue: a source whose stamp label is
  // far wider than the column. `selloLabel` builds it from the doc key and the
  // artículo, so both are stretched here.
  test("a long source title stays inside the column", async ({ page }) => {
    await stubAsk(
      page,
      answerStream("Debe declarar. ", "El plazo corre desde la inscripción.", [
        {
          ...CITATION,
          docKey:
            "resolucion-general-sobre-comprobantes-electronicos-y-procedimientos-tributarios",
          articulo: "Artículo 128 bis, inciso c), párrafo segundo",
        },
      ]),
    );
    await page.goto("/");
    await page.getByLabel("Su pregunta").fill("¿Cuándo declaro?");
    await page.getByRole("button", { name: "Enviar" }).click();

    await expect(
      page.getByRole("link", { name: /Resolución General/ }),
    ).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("prefers-reduced-motion", () => {
  test.use({ viewport: PHONE });

  test("the stamp settles instantly instead of animating", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubAsk(page, answerStream("El IVA no aplica. ", "Facture igual."));
    await page.goto("/");

    await page.getByLabel("Su pregunta").fill("¿Debo cobrar IVA?");
    await page.getByRole("button", { name: "Enviar" }).click();

    const sello = page.getByRole("link", { name: /Reglamento IVA/ });
    await expect(sello).toBeVisible();
    expect(
      await sello.evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
  });
});
