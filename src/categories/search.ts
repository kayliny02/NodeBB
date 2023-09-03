import _ from 'lodash';
import privileges from '../privileges';
import plugins from '../plugins';
import db from '../database';

interface CategoryData {
    cid: number;
    parentCid: number;
    order: number;
    subCategoriesPerPage: number;
    children: any[] | undefined;
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

export default function (Categories: any) {
    Categories.search = async function (data: SearchData) {
        const query = data.query || '';
        const page = data.page || 1;
        const uid = data.uid || 0;
        const paginate = data.hasOwnProperty('paginate') ? data.paginate : true;

        const startTime = process.hrtime();

        let cids = await findCids(query, data.hardCap);

        const result = await plugins.hooks.fire('filter:categories.search', {
            data: data,
            cids: cids,
            uid: uid,
        });
        cids = await privileges.categories.filterCids('find', result.cids, uid);

        const searchResult: {
            matchCount: number;
            pageCount?: number;
            timing?: string;
            categories?: CategoryData[];
        } = {
            matchCount: cids.length,
        };

        if (paginate) {
            const resultsPerPage = data.resultsPerPage || 50;
            const start = Math.max(0, page - 1) * resultsPerPage;
            const stop = start + resultsPerPage;
            searchResult.pageCount = Math.ceil(cids.length / resultsPerPage);
            cids = cids.slice(start, stop);
        }

        const childrenCids = await getChildrenCids(cids, uid);
        const uniqCids = _.uniq(cids.concat(childrenCids));
        const categoryData = await Categories.getCategories(uniqCids, uid);

        Categories.getTree(categoryData, 0);
        await Categories.getRecentTopicReplies(categoryData, uid, data.qs);
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
        const elapsedHrTime = (process.hrtime(startTime));
        const elapsedSeconds = elapsedHrTime[0] + elapsedHrTime[1] / 1e9;
        searchResult.timing = elapsedSeconds.toFixed(2);

        searchResult.categories = categoryData.filter((c: CategoryData) => cids.includes(c.cid));
        return searchResult;
    };

    async function findCids(query: string, hardCap?: number): Promise<number[]> {
        if (!query || String(query).length < 2) {
            return [];
        }
        const data = await db.getSortedSetScan({
            key: 'categories:name',
            match: `*${String(query).toLowerCase()}*`,
            limit: hardCap || 500,
        });
        return data.map((data: String) => parseInt(data.split(':').pop(), 10));
    }

    async function getChildrenCids(cids: number[], uid: number): Promise<number[]> {
        const childrenCids = await Promise.all(cids.map((cid: number)  => Categories.getChildrenCids(cid)));
        return await privileges.categories.filterCids('find', _.flatten(childrenCids), uid);
    }
};
