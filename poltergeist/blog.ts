import { isFullBlock, isFullPage } from "@notionhq/client";
import { logger } from "./logger";
import { createFailureResponse, createSuccessResponse } from "../src/lib/api";
import { NotionClient } from "./notion/notion-client";
import {
  META_DESCRIPTION_PROPERTY,
  META_TITLE_PROPERTY,
  POST_PROPERTY,
  PUBLISHED_PROPERTY,
  SLUG_PROPERTY,
} from "./const";
import type { Block } from "./blocks";
import { mapNotionBlocks } from "./notion/notion-map-blocks";
import type { RichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";

const blogLogger = logger.child({ module: "notion" });

const isDev = import.meta.env.DEV;

export type BlogPost = {
  id: string;
  title: string;
  meta: {
    title: string;
    description: string;
  };
  blocks: Block[];
};

const joinRichPlainText = (richText: RichTextItemResponse[]) => {
  return richText.map((t) => t.plain_text).join(" ");
};

export class Blog {
  private notion: NotionClient;
  constructor() {
    this.notion = new NotionClient();
  }

  async getPostsPaths() {
    try {
      const response = await this.notion.getPosts();
      if (!response.ok) {
        return response;
      }

      const pages = response.data.results.filter(isFullPage).filter((page) => {
        const published = page.properties[PUBLISHED_PROPERTY];

        if (published.type !== "checkbox") {
          blogLogger.error(
            { published },
            `Published attribute must be a checkbox, is ${published.type} instead. Check the value of PUBLISHED_PROPERTY in .env.`
          );

          throw new Error("Published attribute is not a checkbox");
        }

        return isDev ? true : published?.checkbox;
      });
      blogLogger.trace({ pages }, "Fetched pages");

      // ? Should the Notion blocks processing logic be moved somewhere else?
      const paths = pages.map((page) => {
        const slugProperty = page.properties[SLUG_PROPERTY];
        const postProperty = page.properties[POST_PROPERTY];

        const title =
          postProperty.type === "title"
            ? joinRichPlainText(postProperty.title)
            : "";
        const slug =
          slugProperty.type === "rich_text"
            ? joinRichPlainText(slugProperty.rich_text)
            : "";

        return { params: { slug }, props: { id: page.id, title } };
      });

      blogLogger.trace({ paths }, "Returning paths");
      return createSuccessResponse(paths);
    } catch (error) {
      blogLogger.error({ error }, "Failed to get posts paths");
      return createFailureResponse("Something went wrong", "UNKNOWN");
    }
  }

  async getPost(id: string) {
    try {
      const postResponse = await this.notion.getPost(id);
      if (!postResponse.ok) {
        return postResponse;
      }

      if (!isFullPage(postResponse.data)) {
        blogLogger.error("Failed to read blog post");
        return createFailureResponse("Something went wrong", "UNKNOWN");
      }

      const page = postResponse.data;
      const blocksResponse = await this.notion.getBlocks(id);

      if (!blocksResponse.ok) {
        return blocksResponse;
      }

      const blocks = blocksResponse.data.results.filter(isFullBlock);
      blogLogger.trace({ page, blocks }, "Returning blog post data");
      const postProperty = page.properties[POST_PROPERTY];
      const title =
        postProperty.type === "title"
          ? joinRichPlainText(postProperty.title)
          : "";

      const metaTitleProperty = page.properties[META_TITLE_PROPERTY];
      const metaDescriptionProperty =
        page.properties[META_DESCRIPTION_PROPERTY];

      const metaTitle =
        metaTitleProperty.type === "rich_text"
          ? joinRichPlainText(metaTitleProperty.rich_text)
          : title;

      const metaDescription =
        metaDescriptionProperty.type === "rich_text"
          ? joinRichPlainText(metaDescriptionProperty.rich_text)
          : "";

      const post: BlogPost = {
        id: page.id,
        title,
        meta: {
          title: metaTitle,
          description: metaDescription,
        },
        blocks: mapNotionBlocks(blocks),
      };

      return createSuccessResponse(post);
    } catch (error) {
      blogLogger.error({ error }, "Failed to get blog post");
      return createFailureResponse("Something went wrong", "UNKNOWN");
    }
  }
}
