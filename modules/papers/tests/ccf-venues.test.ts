import test from "node:test";
import assert from "node:assert/strict";
import { matchCcfAVenue } from "../backend/ccf-venues.ts";

test("CCF A venue matching accepts catalog aliases and excludes B venues", () => {
  assert.equal(matchCcfAVenue("Conference on Neural Information Processing Systems")?.acronym, "NeurIPS");
  assert.equal(matchCcfAVenue("ACM Transactions on Information Systems")?.area, "数据库/数据挖掘/内容检索");
  assert.equal(matchCcfAVenue("International ACM SIGIR Conference on Research and Development in Information Retrieval")?.kind, "会议");
  assert.equal(matchCcfAVenue("International World Wide Web Conference")?.area, "交叉/综合/新兴");
  assert.equal(matchCcfAVenue("EMNLP"), null);
  assert.equal(matchCcfAVenue("International Conference on Recommender Systems"), null);
});
