// The native snapshot and its exact external-link policy share this URL set.
function projectLinks(repositoryUrl) {
  const github = repositoryUrl.replace(/\/+$/, "");
  return {
    github,
    documentation: github ? `${github}/blob/main/README.md#documentation` : "",
    documentationZhCN: github ? `${github}/blob/main/README.zh-CN.md#documentation` : "",
    license: github ? `${github}/blob/main/LICENSE` : "",
  };
}

module.exports = { projectLinks };
