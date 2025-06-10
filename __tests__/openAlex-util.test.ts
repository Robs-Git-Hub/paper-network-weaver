
import { normalizeOpenAlexId } from "../src/services/openAlex-util";

test("normalizeOpenAlexId strips OpenAlex URL prefixes safely", () => {
  expect(normalizeOpenAlexId("https://openalex.org/W123")).toBe("W123");
  expect(normalizeOpenAlexId("W456")).toBe("W456"); // already clean
  expect(normalizeOpenAlexId("http://openalex.org/W789")).toBe("W789"); // http variant
  expect(normalizeOpenAlexId("")).toBe(""); // empty string
});
