import { defineCollection, type BaseSchema, type CollectionConfig } from 'astro/content/config';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

interface ContentCollections {
  docs: CollectionConfig<BaseSchema>;
}

const docsCollection: CollectionConfig<BaseSchema> = defineCollection({
  loader: docsLoader(),
  schema: docsSchema(),
});

export const collections: ContentCollections = {
  docs: docsCollection,
};
