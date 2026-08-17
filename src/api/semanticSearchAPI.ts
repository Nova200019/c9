import axios from "axios";

export const semanticSearchAPI = async (query: string) => {
  const response = await axios.post("/file-service/semantic-search", { query });
  return response.data;
};