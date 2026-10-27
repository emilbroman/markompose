import { Composer } from "../src";

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

// Fill the scrolling scenario with enough content to overflow.
$<Composer>("#long").value = Array.from(
  { length: 40 },
  (_, i) => `${i + 1}. Line number ${i + 1} with some **Markdown** in it`,
).join("\n");

// Form scenario
const form = $<HTMLFormElement>("#form");
const formOutput = $<HTMLPreElement>("#form-output");
form.addEventListener("submit", (event) => {
  event.preventDefault();
  formOutput.textContent = JSON.stringify(Object.fromEntries(new FormData(form)), null, 2);
});
form.addEventListener("reset", () => (formOutput.textContent = ""));
$<HTMLInputElement>("#toggle-fieldset").addEventListener("change", (event) => {
  $<HTMLFieldSetElement>("#fieldset").disabled = (event.target as HTMLInputElement).checked;
});

// Programmatic API scenario
const api = $<Composer>("#api");
const apiOutput = $<HTMLPreElement>("#api-output");
const report = () =>
  (apiOutput.textContent = JSON.stringify(
    { value: api.value, selectionStart: api.selectionStart, selectionEnd: api.selectionEnd },
    null,
    2,
  ));

const actions: Record<string, () => void> = {
  read: report,
  "select-all": () => (api.focus(), api.select(), report()),
  set: () => (api.value = "Replaced *programmatically* at " + new Date().toLocaleTimeString()),
  "select-word": () => (api.focus(), api.setSelectionRange(7, 11), report()),
};
document.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
  if (action) actions[action]?.();
});

// Log events from every composer, to see what fires when.
for (const composer of document.querySelectorAll("markompose-composer")) {
  for (const type of ["input", "change"]) {
    composer.addEventListener(type, () => console.debug(type, composer.id || composer.getAttribute("name") || composer, composer.value));
  }
}
