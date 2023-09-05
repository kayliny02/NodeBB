// assistance of chatgpt was used when debugging errors
import _ from 'lodash';
import privileges from '../privileges';
import plugins from '../plugins';
import db from '../database';

interface CategoryData {
  cid: number;
  parentCid: number;
  order: number;
  subCategoriesPerPage: number;
  children?: CategoryData[];
}

interface SearchData {
  query?: string;
  page?: number;
  uid?: number;
  paginate?: boolean;
  hardCap?: number;
  resultsPerPage?: number;
  qs?: boolean;
}

interface SearchResult {
  matchCount: number;
  pageCount?: number;
  timing?: string;
  categories?: CategoryData[];
}

interface Categories {
  search: (data: SearchData) => Promise<SearchResult>;
  getCategories: (cids: number[], uid: number) => Promise<CategoryData[]>;
  getTree: (data: CategoryData[], parentId: number) => void;
  getRecentTopicReplies: (data: CategoryData[], uid: number, qs?: boolean) => void;
  getChildrenCids: (cid: number) => Promise<number[]>;
}

export = function (Categories: Categories) {
    Categories.search = async function (data: SearchData): Promise<SearchResult> {
        const query = data.query || '';
        const page = data.page || 1;
        const uid = data.uid || 0;
        const paginate = data.hasOwnProperty('paginate') ? data.paginate : true;
        const startTime = process.hrtime();

        async function findCids(query: string, hardCap?: number): Promise<number[]> {
            if (!query || query.length < 2) {
                return [];
            }
            // The next line calls a function in a module that has not been updated to TS yet
            /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call,
               @typescript-eslint/no-unsafe-member-access */
            const data: string[] = await db.getSortedSetScan({
                key: 'categories:name',
                match: `*${query.toLowerCase()}*`,
                limit: hardCap || 500,
            });
            return data.map((item: string) => parseInt(item.split(':').pop(), 10));
        }

        let cids = await findCids(query, data.hardCap);

        // The next line calls a function in a module that has not been updated to TS yet
        /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call,
            @typescript-eslint/no-unsafe-member-access */
        const result = await plugins.hooks.fire<SearchResult>('filter:categories.search', {
            data,
            cids,
            uid,
        });
        // The next line calls a function in a module that has not been updated to TS yet
        /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call,
            @typescript-eslint/no-unsafe-member-access */
        cids = await privileges.categories.filterCids('find', result.cids, uid);

        const searchResult: SearchResult = {
            matchCount: cids.length,
        };

        if (paginate) {
            const resultsPerPage = data.resultsPerPage || 50;
            const start = Math.max(0, page - 1) * resultsPerPage;
            const stop = start + resultsPerPage;
            searchResult.pageCount = Math.ceil(cids.length / resultsPerPage);
            cids = cids.slice(start, stop);
        }

        async function getChildrenCids(cids: number[], uid: number): Promise<number[]> {
            const childrenCids = await Promise.all(cids.map((cid: number) => Categories.getChildrenCids(cid)));
            return await privileges.categories.filterCids('find', _.flatten(childrenCids), uid) as number[];
        }

        const childrenCids = await getChildrenCids(cids, uid);
        const uniqCids = _.uniq(cids.concat(childrenCids));
        const categoryData = await Categories.getCategories(uniqCids, uid);

        Categories.getTree(categoryData, 0);
        Categories.getRecentTopicReplies(categoryData, uid, data.qs);
        categoryData.forEach((category: CategoryData) => {
            if (category && Array.isArray(category.children)) {
                category.children = category.children.slice(0, category.subCategoriesPerPage);
                category.children.forEach((child) => {
                    child.children = undefined;
                });
            }
        });

        categoryData.sort((c1: CategoryData, c2: CategoryData) => {
            if (c1.parentCid !== c2.parentCid) {
                return c1.parentCid - c2.parentCid;
            }
            return c1.order - c2.order;
        });

        const elapsedHrTime = process.hrtime(startTime);
        const elapsedSeconds = elapsedHrTime[0] + (elapsedHrTime[1] / 1e9);
        searchResult.timing = elapsedSeconds.toFixed(2);

        searchResult.categories = categoryData.filter((c: CategoryData) => cids.includes(c.cid));
        return searchResult;
    };
}
