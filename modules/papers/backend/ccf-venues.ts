export interface CcfVenue {
  acronym: string;
  area: "人工智能" | "数据库/数据挖掘/内容检索" | "计算机图形学与多媒体" | "交叉/综合/新兴";
  kind: "会议" | "期刊";
  name: string;
  aliases: string[];
}

// CCF 2022 recommended catalog, with official name changes published in 2024.
// Scope is restricted to the four areas that match the initial product topics.
export const CCF_A_VENUES: CcfVenue[] = [
  { acronym: "AAAI", area: "人工智能", kind: "会议", name: "AAAI Conference on Artificial Intelligence", aliases: ["AAAI", "AAAI Conference on Artificial Intelligence"] },
  { acronym: "NeurIPS", area: "人工智能", kind: "会议", name: "Conference on Neural Information Processing Systems", aliases: ["NeurIPS", "NIPS", "Conference on Neural Information Processing Systems", "Advances in Neural Information Processing Systems"] },
  { acronym: "ACL", area: "人工智能", kind: "会议", name: "Annual Meeting of the Association for Computational Linguistics", aliases: ["ACL", "Annual Meeting of the Association for Computational Linguistics"] },
  { acronym: "CVPR", area: "人工智能", kind: "会议", name: "IEEE/CVF Conference on Computer Vision and Pattern Recognition", aliases: ["CVPR", "IEEE/CVF Conference on Computer Vision and Pattern Recognition"] },
  { acronym: "ICCV", area: "人工智能", kind: "会议", name: "International Conference on Computer Vision", aliases: ["ICCV", "International Conference on Computer Vision"] },
  { acronym: "ICML", area: "人工智能", kind: "会议", name: "International Conference on Machine Learning", aliases: ["ICML", "International Conference on Machine Learning"] },
  { acronym: "IJCAI", area: "人工智能", kind: "会议", name: "International Joint Conference on Artificial Intelligence", aliases: ["IJCAI", "International Joint Conference on Artificial Intelligence"] },
  { acronym: "Artificial Intelligence", area: "人工智能", kind: "期刊", name: "Artificial Intelligence", aliases: ["Artificial Intelligence"] },
  { acronym: "TPAMI", area: "人工智能", kind: "期刊", name: "IEEE Transactions on Pattern Analysis and Machine Intelligence", aliases: ["TPAMI", "IEEE Transactions on Pattern Analysis and Machine Intelligence"] },
  { acronym: "IJCV", area: "人工智能", kind: "期刊", name: "International Journal of Computer Vision", aliases: ["IJCV", "International Journal of Computer Vision"] },
  { acronym: "JMLR", area: "人工智能", kind: "期刊", name: "Journal of Machine Learning Research", aliases: ["JMLR", "Journal of Machine Learning Research"] },
  { acronym: "SIGMOD", area: "数据库/数据挖掘/内容检索", kind: "会议", name: "ACM SIGMOD Conference", aliases: ["SIGMOD", "ACM SIGMOD Conference"] },
  { acronym: "SIGKDD", area: "数据库/数据挖掘/内容检索", kind: "会议", name: "ACM SIGKDD Conference on Knowledge Discovery and Data Mining", aliases: ["SIGKDD", "KDD", "ACM SIGKDD Conference on Knowledge Discovery and Data Mining"] },
  { acronym: "ICDE", area: "数据库/数据挖掘/内容检索", kind: "会议", name: "IEEE International Conference on Data Engineering", aliases: ["ICDE", "IEEE International Conference on Data Engineering"] },
  { acronym: "SIGIR", area: "数据库/数据挖掘/内容检索", kind: "会议", name: "International ACM SIGIR Conference on Research and Development in Information Retrieval", aliases: ["SIGIR", "International ACM SIGIR Conference on Research and Development in Information Retrieval"] },
  { acronym: "VLDB", area: "数据库/数据挖掘/内容检索", kind: "会议", name: "International Conference on Very Large Data Bases", aliases: ["VLDB", "International Conference on Very Large Data Bases"] },
  { acronym: "TODS", area: "数据库/数据挖掘/内容检索", kind: "期刊", name: "ACM Transactions on Database Systems", aliases: ["TODS", "ACM Transactions on Database Systems"] },
  { acronym: "TOIS", area: "数据库/数据挖掘/内容检索", kind: "期刊", name: "ACM Transactions on Information Systems", aliases: ["TOIS", "ACM Transactions on Information Systems"] },
  { acronym: "TKDE", area: "数据库/数据挖掘/内容检索", kind: "期刊", name: "IEEE Transactions on Knowledge and Data Engineering", aliases: ["TKDE", "IEEE Transactions on Knowledge and Data Engineering"] },
  { acronym: "VLDB Journal", area: "数据库/数据挖掘/内容检索", kind: "期刊", name: "The VLDB Journal", aliases: ["VLDB Journal", "The VLDB Journal"] },
  { acronym: "WWW", area: "交叉/综合/新兴", kind: "会议", name: "International World Wide Web Conference", aliases: ["WWW", "The Web Conference", "International World Wide Web Conference"] },
  { acronym: "ACM MM", area: "计算机图形学与多媒体", kind: "会议", name: "ACM International Conference on Multimedia", aliases: ["ACM MM", "ACM Multimedia", "ACM International Conference on Multimedia"] },
  { acronym: "SIGGRAPH", area: "计算机图形学与多媒体", kind: "会议", name: "ACM SIGGRAPH Conference on Computer Graphics", aliases: ["SIGGRAPH", "ACM SIGGRAPH Conference on Computer Graphics"] },
  { acronym: "VR", area: "计算机图形学与多媒体", kind: "会议", name: "IEEE Conference on Virtual Reality and 3D User Interfaces", aliases: ["IEEE VR", "IEEE Conference on Virtual Reality and 3D User Interfaces"] },
  { acronym: "IEEE VIS", area: "计算机图形学与多媒体", kind: "会议", name: "IEEE Visualization Conference", aliases: ["IEEE VIS", "IEEE Visualization Conference"] },
  { acronym: "TOG", area: "计算机图形学与多媒体", kind: "期刊", name: "ACM Transactions on Graphics", aliases: ["TOG", "ACM Transactions on Graphics"] },
  { acronym: "TIP", area: "计算机图形学与多媒体", kind: "期刊", name: "IEEE Transactions on Image Processing", aliases: ["TIP", "IEEE Transactions on Image Processing"] },
  { acronym: "TVCG", area: "计算机图形学与多媒体", kind: "期刊", name: "IEEE Transactions on Visualization and Computer Graphics", aliases: ["TVCG", "IEEE Transactions on Visualization and Computer Graphics"] },
];

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

export function matchCcfAVenue(name: string): CcfVenue | null {
  const normalized = normalize(name);
  if (!normalized) return null;
  return CCF_A_VENUES.find((venue) => venue.aliases.some((alias) => {
    const key = normalize(alias);
    return normalized === key || (venue.kind==='会议'&&key.length>12&&normalized.includes(key));
  })) ?? null;
}
