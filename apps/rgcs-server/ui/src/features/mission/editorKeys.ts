// Which key events the mission editor's shortcuts (Delete, ⌘Z, arrows…) must leave alone: typing in
// a field, keys on a control (button, radio, slider…) and anything inside the survey panel.
const TEXT_TAGS = ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']
const CONTROL_ROLES = ['button', 'radio', 'checkbox', 'switch', 'slider', 'spinbutton', 'textbox', 'combobox', 'menuitem', 'tab']

export function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (TEXT_TAGS.includes(t.tagName) || t.isContentEditable) return true
  if (CONTROL_ROLES.includes(t.getAttribute('role') ?? '')) return true
  return t.closest('.survey-panel') !== null
}
