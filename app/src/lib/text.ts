/** Normaliza texto para comparar sin tildes ni mayúsculas ("Clínica" → "clinica"). */
export function fold(s: string | null | undefined) {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** ¿`text` contiene `query`, ignorando tildes y mayúsculas? */
export function matches(text: string | null | undefined, query: string) {
  return fold(text).includes(fold(query));
}
