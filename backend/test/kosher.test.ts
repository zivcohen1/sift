import { describe, expect, it } from "vitest";
import { collectCertifications, enrichProduct, parseKosherMarks, type SourceProductLike } from "../src/enrich";

/** Kosher (or halal) status for an ingredient list, optionally with label tags or label text. */
const status = (ingredientsText: string, extra: Partial<SourceProductLike> = {}, scheme: "kosher" | "halal" = "kosher") =>
  enrichProduct({ ingredientsText, nutrition: null, ...extra }, "open_food_facts").religious[scheme];

const agencies = (labelsText: string) =>
  collectCertifications({ labelsText, nutrition: null }, "kosher").map((c) => c.agencyId);

describe("forbidden ingredients use the full category lists", () => {
  it.each(["ham", "prosciutto", "gammon", "shrimp", "crab", "lobster", "clams", "oysters", "scallops", "squid"])(
    "%s is not kosher",
    (food) => expect(status(`${food}, salt`).status).toBe("forbidden_ingredient"),
  );
  it("catches carmine by its E-number and other names", () => {
    expect(status("sugar, colour (E120)").status).toBe("forbidden_ingredient");
    expect(status("sugar, carminic acid").status).toBe("forbidden_ingredient");
  });
  it("reads 'Contains:' statements too", () => {
    expect(status("pasta, salt. Contains: shellfish.").status).toBe("forbidden_ingredient");
  });
  it("keeps shellac doubtful, not forbidden", () => {
    const a = status("sugar, shellac");
    expect(a.status).not.toBe("forbidden_ingredient");
    expect(a.concerns).toContainEqual({ ingredient: "shellac", severity: "doubtful" });
  });
});

describe("no false alarms", () => {
  it.each(["turkey bacon", "imitation bacon bits", "blood orange juice", "graham crackers", "oyster mushrooms", "crab apple jelly"])(
    "%s is not forbidden",
    (food) => expect(status(`${food}, salt`).status).toBe("not_certified"),
  );
  it("still allows fish with dairy", () => {
    expect(status("salmon, cream cheese").status).toBe("not_certified");
  });
});

describe("certification against the ingredients", () => {
  it("does not show Good for OU-tagged ham or shrimp", () => {
    expect(status("ham, salt", { labelTags: ["en:ou-kosher"] }).status).toBe("conflicting_data");
    expect(status("shrimp, salt", { labelTags: ["en:ou-kosher"] }).status).toBe("conflicting_data");
  });
  it("a bare 'kosher' tag does not soften pork", () => {
    expect(status("pork, salt", { labelTags: ["en:kosher"] }).status).toBe("forbidden_ingredient");
  });
  it("without a label, a clean product is not certified (never assumed kosher)", () => {
    expect(status("green beans, water, salt").status).toBe("not_certified");
  });
});

describe("wine is kosher only when certified", () => {
  it.each(["red wine", "grape juice concentrate", "brandy", "red wine vinegar"])("%s without a label is not kosher", (w) => {
    const a = status(`water, ${w}, salt`);
    expect(a.status).toBe("forbidden_ingredient");
    expect(a.summary).toContain("only with a certification");
  });
  it("is fine with a recognised certification", () => {
    expect(status("red wine, sulfites", { labelsText: "OU" }).status).toBe("certified");
  });
  it("a bare 'kosher' claim is not enough", () => {
    expect(status("red wine", { labelTags: ["en:kosher"] }).status).toBe("forbidden_ingredient");
  });
});

describe("reading certifier marks", () => {
  it.each([
    ["STAR-K", "star-k"], ["Star K", "star-k"], ["KOF-K", "kof-k"], ["Kof K", "kof-k"],
    ["CRC", "crc"], ["cRc", "crc"], ["Ok Kosher", "ok"], ["OK-D", "ok"], ["OU Pareve", "ou"],
  ])("%s is %s", (text, id) => expect(agencies(text)).toEqual([id]));
  it("reads every mark on the label", () => {
    expect(agencies("OK, Star-K")).toEqual(["ok", "star-k"]);
  });
  it("ignores ordinary words", () => {
    expect(agencies("tastes ok")).toEqual([]);
    expect(agencies("sucre ou miel")).toEqual([]);
    expect(agencies("Stark Farms")).toEqual([]);
  });
  it("keeps the designation", () => {
    expect(parseKosherMarks("OU-D, Star-K Pareve")).toEqual([
      { agency: "OU", designation: "dairy" },
      { agency: "Star-K", designation: "pareve" },
    ]);
  });
  it("recognises OK and cRc in Open Food Facts tags", () => {
    const ids = (tag: string) => collectCertifications({ labelTags: [tag], nutrition: null }, "kosher").map((c) => c.agencyId);
    expect(ids("en:ok-kosher")).toEqual(["ok"]);
    expect(ids("en:crc-kosher")).toEqual(["crc"]);
  });
});

describe("meat with dairy names both ingredients", () => {
  it("so the app can mark the beef and the cheese rows", () => {
    const meatDairy = status("beef, cheese").concerns.find((c) => c.ingredient === "meat with dairy");
    expect(meatDairy?.terms).toEqual(["beef", "cheese"]);
  });
});

describe("halal gets the same lists", () => {
  it.each(["ham, salt", "prosciutto, salt", "water, white wine"])("%s is not halal", (text) =>
    expect(status(text, {}, "halal").status).toBe("forbidden_ingredient"),
  );
  it("turkey bacon is not flagged", () => {
    expect(status("turkey bacon, salt", {}, "halal").status).not.toBe("forbidden_ingredient");
  });
});

describe("fish and animals that are never kosher", () => {
  it.each(["catfish", "eel", "shark", "swordfish", "rabbit"])("%s is not kosher", (food) =>
    expect(status(`${food}, salt`).status).toBe("forbidden_ingredient"),
  );
  it("but they are not flagged for halal", () => {
    expect(status("rabbit, salt", {}, "halal").status).not.toBe("forbidden_ingredient");
  });
  it("other spellings of doubtful ingredients are marked", () => {
    expect(status("natural flavour, glycerine, emulsifier (E471)").concerns.map((c) => c.ingredient)).toEqual(
      expect.arrayContaining(["natural flavour", "glycerine", "E471"]),
    );
  });
});
