# Admin option A asset manifest

Approved reference: `.impeccable/mocks/admin-a-workbench.png` (1505 × 1045).

The shipped Impeccable asset-producer role was unavailable; a fresh reviewer applied `reference/degraded/asset-producer.md` for this manifest-only pass.

**Build-critical static imagery: none.** The approved workbench is composed of typography, controls, layout, and a private capture evidence viewer. Do not ship the mock or any crop from it as interface pixels. No image generation is needed.

## Produce

None. There are no photographic, illustrative, texture, or decorative raster assets to generate or clean up.

## Direct

None supplied. The example page shown inside the comp is illustrative reference content, not a supplied production screenshot. Real capture screenshots are private runtime evidence and must come from the existing authorized capture artifact path. Never generate, reconstruct, or substitute that evidence from the comp.

## Semantic

All rows below were accepted after visually inspecting the complete approved comp. Acceptance covers asset classification and implementation handoff, not verification of the eventual interface.

| id | implementation | notes | qa_status |
| --- | --- | --- | --- |
| admin-shell | Use a page header, text brand/title, status summary, navigation, and main landmark. CSS owns the white/off-white surfaces, thin gray separators, compact horizontal spacing, and dark ink text. Allow header summaries to wrap on narrow screens. | The product name is live text; no logo raster or decorative background is required. Compose with no produced assets. | accepted |
| primary-navigation | Render the five destinations as accessible links or existing route controls. CSS owns the teal active underline, active text weight, spacing, and bottom rule. Allow horizontal overflow or a deliberate compact layout without clipping link labels. | Preserve keyboard focus and actual active route semantics. | accepted |
| capture-status | Render the capture status with text plus a CSS circular indicator; use ordinary text for reserve and target values and a CSS divider. | Color is supplemental to the status text. Values must come from real application state. | accepted |
| typography | Use the project's available sans-serif font stack for title, headings, body, metadata, and controls. CSS owns hierarchy: large dark section headings, medium-weight row titles, smaller muted metadata, and restrained line heights. | No rasterized text or new static font image is needed. Match the reference hierarchy with existing font resources; the comp does not establish a licensed font requirement. | accepted |
| search-and-filter | Use a labeled search input and select control with native semantics. Draw the magnifier and optional chevron using existing vector icons or inline SVG. CSS owns borders, modest corner radius, sizing, and spacing; stack controls on small screens. | Placeholder text does not replace an accessible label. Icons require no bitmap. | accepted |
| review-workbench | Build a CSS grid with queue and detail regions, approximately one-third/two-thirds of the content width at the reference viewport. Use semantic section headings and logical DOM order. On narrow screens stack the queue and selected detail or use the existing accessible selection flow. | CSS owns all panel borders, backgrounds, gaps, and corner radii. No frame or card raster. | accepted |
| capture-queue | Render an ordered or unordered list of selectable records with live title, URL, timestamp, and status badge. CSS owns row dividers, pale teal selected fill, and generous hit areas. Use buttons or links for selection and communicate selected state accessibly. | Long URLs must wrap or truncate without forcing horizontal page overflow. All illustrated records and dates are sample data. | accepted |
| queue-controls | Use the existing page indicator and pagination buttons. No sort control or total-count claim is supported. CSS owns disabled styling and the footer separator. | Pagination disabled states must follow actual data; keep count and page information live. | accepted |
| review-detail-header | Use a heading, safe URL link or text, timestamp, and text status badge. CSS aligns metadata and badge toward the right at wide widths and wraps them on narrow screens. | Status pills are CSS backgrounds/borders plus text, not assets. | accepted |
| evidence-container | Build a bordered section with heading, view controls, slice count, viewport, and metadata footer. CSS owns the muted gray evidence canvas, clipping, padding, separators, and responsive dimensions. Use a real image element for authorized screenshot evidence, with containment that preserves its aspect ratio; show only the existing screenshot and slice image representations. | The viewport is semantic layout. Its image content is private captured evidence obtained at runtime. Do not crop the comp, embed its example page, generate evidence, or copy private captures into public/static assets. Show real loading, empty, and error states when evidence is unavailable. | accepted |
| evidence-view-controls | Use a labeled native selector for the analysis screenshot and each actual slice, plus an authenticated full-size image link. The approved semantic exceptions exclude invented rendered-page/source modes. | Mode labels must describe the actual evidence representation. No control screenshot or generated page image is needed. | accepted |
| evidence-metadata | Use a definition list or equivalent labeled semantic fields for capture date, retained artifacts, and review requirement. CSS owns the three-column desktop layout and vertical dividers; stack fields on narrow screens. | Populate from real artifact metadata and policy. Do not treat mock copy as evidence of retained files. | accepted |
| review-decision | Use a form section with heading, approve/block/return buttons, labeled required textarea, and explicit confirmation. CSS owns button hierarchy, borders, input radius, and compact grouping; wrap actions on smaller screens. | Keep review actions attached to the selected record and existing confirmation/validation behavior. The note field and all button text remain selectable semantic text. | accepted |
| rules-and-history | Use an accessible disclosure button with expanded state, or native details/summary, connected to the rules/history content. Use an existing chevron icon or inline SVG. CSS owns the border, padding, and collapsed row treatment. | No raster arrow or collapsed-section screenshot. | accepted |

## execution_order

1. Implement the semantic shell, navigation, typography, and responsive workbench structure.
2. Implement live queue controls, selected record detail, metadata, and review form.
3. Compose authorized private capture artifacts into the semantic evidence viewer and verify image selection using synthetic local capture data; preserve existing authorized runtime evidence paths.
4. Compare the finished interface against the approved comp at desktop and narrow widths, including selected, loading, empty, error, and disabled states.

There is no raster production sequence or static image delivery dependency. No asset output paths, generation prompts, image formats, alpha channels, or raster dimensions apply because no assets are being produced or directly shipped.

## blockers

None for static asset production or semantic implementation. Runtime evidence display requires the application's existing authorized artifact source; absent evidence should produce a truthful empty/error state, not replacement imagery.

## assumptions

- The approved comp establishes layout, palette, and visual hierarchy; its example records, dates, status, and reserve values are illustrative.
- Existing application font resources and vector icons are sufficient. This pass introduces no font download or external image dependency.
- Capture evidence remains private and is rendered through the existing authorization and artifact handling paths.
- Only this manifest is authored in this pass. No UI files or approved mock pixels are modified.
