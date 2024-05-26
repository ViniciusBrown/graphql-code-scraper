import axios from "axios";

const GITHUB_API_URL = "https://api.github.com";



// export default function getGithubFile(path: string, repository: string): Promise<string> {
//   const config = {
//     headers: {
//       Accept: "application/vnd.github.raw+json",
//       Authorization: "Bearer " + gitHubApiToken,
//       "X-GitHub-Api-Version": "2022-11-28",
//     },
//   };

//   return axios.get(`${GITHUB_API_URL}/repos/pinternal/${repository}/contents/${path}`, config).then(
//     (response) => {
//       if (response.data.content) {
//         return response.data.content;
//       } else {
//         return response.data;
//       }
//     },
//     (error) => {
//       return Promise.reject(error);
//     },
//   );
// }