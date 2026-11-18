import assert from "node:assert/strict";
import { test } from "node:test";
import { sqlFixture, seedLegacyPosts } from "./helpers/sql-fixture";
import { cutoverSchema } from "../scripts/cutover-entra-sql";
test("cutover preserves original legacy content and account ownership across repeated migration", async () => {
  const fixture = await sqlFixture();
  try {
    const post = await fixture.service.create({ title: "소유권 보존", content: "본문 한글\n줄바꿈" }, fixture.context);
    await seedLegacyPosts(fixture.pool, [{ title: "기존 제목", content: "원본 본문", nickname: "기존 작성자" }]);
    let verified = false;
    const result = await cutoverSchema(fixture.pool, async () => { verified = true; });
    assert.equal(verified, true); assert.deepEqual(result, { schemaVersion: 5, preservedPosts: 2, preservedAttachments: 0 });
    assert.deepEqual(await fixture.service.get(post.id, fixture.principal), post);
  } finally { await fixture.close(); }
});
