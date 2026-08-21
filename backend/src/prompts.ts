import type { Profile, ReviewMode } from "./types.js";

export const RADIOLOGY_TERMS = [
  "BI-RADS", "PI-RADS", "TI-RADS", "LI-RADS", "Lung-RADS", "O-RADS", "Bosniak", "RECIST", "ASPECTS",
  "DWI", "ADC", "FLAIR", "STIR", "TIRM", "SWI", "TOF", "HASTE", "VIBE", "DIXON", "MRCP", "MPR", "MIP",
  "Gadovist", "Dotarem", "Primovist", "Imeron", "Ultravist", "Accupaque", "ProHance", "Visipaque",
  "gadoliniumhaltiges Kontrastmittel", "jodhaltiges Kontrastmittel"
];

const transcriptionPrompts: Record<Profile, string> = {
  "de-general": "Deutschsprachiges allgemeines Diktat. Transkribiere nur den gesprochenen Inhalt originalgetreu als natürlich gesetzten Fließtext. Ergänze, interpretiere oder fasse nichts zusammen. Setze gesprochene Diktierbefehle wie Punkt, Komma, Doppelpunkt, Absatz und neue Zeile als Satzzeichen beziehungsweise Zeilenumbruch um.",
  "en-general": "English general-purpose dictation. Transcribe only the spoken content faithfully with natural punctuation. Do not add, interpret, summarize, or restructure information. Render spoken punctuation and paragraph commands as punctuation and line breaks.",
  "de-radiology": "Deutschsprachiges radiologisches Befunddiktat. Transkribiere ausschließlich Gesprochenes; nichts ergänzen, weglassen, deuten oder medizinisch korrigieren. Telegrammstil, Negationen, Seite, Lokalisation, Zahlen, Maße, Einheiten, Vergleiche, Bildreferenzen, Scores und diagnostische Sicherheit exakt erhalten. Keine Diagnosen oder Normalbefunde hinzufügen. Deutsches Dezimalkomma verwenden und Zahlen niemals verändern. Eigenständig gesprochene Diktierbefehle wie Punkt, Komma, Doppelpunkt, Absatz, neue Zeile, Klammer auf und Klammer zu als entsprechende Zeichen ausgeben."
};

export function parseDictionary(value: string) {
  const seen = new Set<string>();
  const terms: Array<{ heard: string; spelling: string; keyword: string }> = [];
  for (const raw of value.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length > 200) throw new Error("Wörterbucheinträge dürfen höchstens 200 Zeichen lang sein");
    const parts = line.split("=>");
    if (parts.length > 2) throw new Error(`Ungültiger Wörterbucheintrag: ${line}`);
    const heard = (parts[0] ?? "").trim(), spelling = (parts[1] ?? parts[0] ?? "").trim();
    if (!heard || !spelling || /[<>\r\n]/.test(heard) || /[<>\r\n]/.test(spelling)) throw new Error(`Ungültiger Wörterbucheintrag: ${line}`);
    const key = `${heard.toLocaleLowerCase()}=>${spelling.toLocaleLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); terms.push({ heard, spelling, keyword: spelling }); }
  }
  return terms;
}

export function transcriptionContext(profile: Profile, dictionary: string, pack: boolean, previous: string) {
  const custom = parseDictionary(dictionary);
  const keywords = [...custom.map((item) => item.keyword), ...(profile === "de-radiology" && pack ? RADIOLOGY_TERMS : [])]
    .filter((term, index, list) => list.findIndex((other) => other.toLocaleLowerCase() === term.toLocaleLowerCase()) === index)
    .slice(0, 100);
  const mappings = custom.filter((item) => item.heard !== item.spelling);
  const parts = [transcriptionPrompts[profile]];
  if (mappings.length) parts.push(`Schreibweisen: ${mappings.map((item) => `${item.heard} => ${item.spelling}`).join("; ")}.`);
  const tail = previous.trim().slice(-300);
  if (tail) parts.push(`Vorheriger erfolgreicher Kontext (nicht wiederholen): ${tail}`);
  return { languages: [profile === "en-general" ? "en" : "de"], keywords, prompt: parts.join("\n\n") };
}

export function reviewInstructions(profile: Profile, mode: ReviewMode, dictionary: string) {
  const de = profile !== "en-general", fillers = mode === "fillers";
  const instructions = [de
    ? (fillers ? "Korrigiere nur Rechtschreibung, Groß-/Kleinschreibung und Zeichensetzung. Entferne nur eindeutige Fülllaute, klare Füllwörter und direkte Wiederholungen. Keine stilistische Glättung. Unsicherheitsmarker niemals entfernen." : "Korrigiere nur Rechtschreibung, Groß-/Kleinschreibung und Zeichensetzung. Nicht umformulieren oder zusammenfassen.")
    : (fillers ? "Correct spelling, capitalization, and punctuation. Remove only unmistakable filler sounds, clear filler words, and direct repetitions. Do not smooth or summarize." : "Correct only spelling, capitalization, and punctuation. Do not rewrite or summarize.")];
  const mappings = parseDictionary(dictionary).filter((item) => item.heard !== item.spelling);
  if (mappings.length) instructions.push(`Diese Zuordnungen exakt anwenden: ${mappings.map((item) => `${item.heard} => ${item.spelling}`).join("; ")}.`);
  if (profile === "de-radiology") instructions.push("Negationen, Seiten, Lokalisationen, Zahlen, Maße, Einheiten, Bildreferenzen, Scores, Codes und Vergleichswerte exakt erhalten. Diagnostische Sicherheit nicht verändern. Keine Befunde, Diagnosen, Überschriften oder Markdown ergänzen.");
  instructions.push(de ? "Ausschließlich den überarbeiteten Klartext zurückgeben." : "Return only the revised plain text.");
  return instructions.join("\n\n");
}
