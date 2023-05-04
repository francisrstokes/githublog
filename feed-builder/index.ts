import * as fs from 'fs/promises';
import * as path from 'path';

// Libs for processing markdown content
import {remark} from 'remark';
import strip from 'strip-markdown';

// Sigh...
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const yearRegex = /^2[0-9]{3}$/; // Only expect blogs written in this millennium
const repoDir = path.join(__dirname, '..');
const feedPath = path.join(repoDir, 'feed.xml');

const githubURLBase = 'https://github.com/francisrstokes/githublog';
const githubURLPrefix = `${githubURLBase}/blob/main`;

const blogTitle = 'Francis Stokes :: Githublog';
const blogDescription = "I'm sick of complex blogging solutions, so markdown files in a git repo it is.";
const copyrightField = `${new Date().getFullYear()} Francis Stokes - All rights reserved`;
const lastBuildDate = new Date().toUTCString();
const ttl = 86400 / 60; // 1 day, in minutes

const descriptionCharsToUse = 420;

// Pff, use a real XML library? What does this look like? An actual blog framework?!
const rssTemplate = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
 <title>${blogTitle}</title>
 <description>${blogDescription}</description>
 <link>${githubURLBase}</link>
 <copyright>${copyrightField}</copyright>
 <lastBuildDate>${lastBuildDate}</lastBuildDate>
 <pubDate>${lastBuildDate}</pubDate>
 <ttl>${ttl}</ttl>

{blog_entries}

</channel>
</rss>
`;

const stripMarkdown = (text: string) => remark().use(strip).process(text).then(String);

type PostInfo = {
  title: string;
  description: string;
};
const extractPostInfo = async (markdownContents: string): Promise<PostInfo> => {
  const contentWithoutEmptyLines = markdownContents.split('\n').filter(Boolean);

  const title = await stripMarkdown(contentWithoutEmptyLines[0]);

  const nonTitleContent = contentWithoutEmptyLines.slice(1)
    .join('\n')
    .slice(0, descriptionCharsToUse);

  const description = (await stripMarkdown(nonTitleContent)).trim().replace(/\n/g, ' ') + '...';

  return { title, description };
};

const generateRSSItem = (postInfo: PostInfo, link: string, date: string) => `<item>
  <title>${postInfo.title}</title>
  <description>${postInfo.description}</description>
  <link>${link}</link>
  <pubDate>${date}</pubDate>
</item>
`;

const findBlogsInYearDir = async (yearDir: string) => {
  const monthDirs = await fs.readdir(yearDir);

  // Read all of the day directories concurrently into a flat list
  const dayDirs = await Promise.all(monthDirs.map(month => {
    const fullMonthDir = path.join(yearDir, month);
    return fs.readdir(fullMonthDir)
      .then(days => days.map(day => path.join(fullMonthDir, day)));
  }))
  .then(monthIndexedDays => monthIndexedDays.flat());

  // Read all of the blog entries concurrently into a flat list
  return Promise.all(dayDirs.map(dayDir => {
    return fs.readdir(dayDir)
      .then(blogEntries => blogEntries.map(blog => path.join(dayDir, blog)));
  }))
  .then(dayIndexedBlogs => dayIndexedBlogs.flat());
}

const main = async () => {
  const results = await fs.readdir(repoDir);

  const blogDirs = results
    .filter(dir => yearRegex.test(dir))
    .map(yearDir => path.join(repoDir, yearDir));

  const allBlogs = await Promise.all(blogDirs.map(findBlogsInYearDir))
    .then(allBlogsInYear => allBlogsInYear.flat());

  // Order by date. Probably a better way of doing this, but you know what they say:
  // When you've got regular expressions, everything looks like a parsing problem!
  const dateExtractionRegex = /.+?(2\d{3}\/\d{1,2}\/\d{1,2}).+/;
  allBlogs.sort((a, b) => {
    const aMatchResult = a.match(dateExtractionRegex);
    const bMatchResult = b.match(dateExtractionRegex);

    if (!aMatchResult || !bMatchResult) return 0;
    if (aMatchResult.length < 1 || bMatchResult.length < 1) return 0;

    return +(new Date(aMatchResult[1])) - +(new Date(bMatchResult[1]));
  });

  // Get post info for all blogs
  const postInfo = await Promise.all(allBlogs.map(blog => fs.readFile(blog, 'utf-8').then(extractPostInfo)));

  // Get all blog publication dates
  const dates = allBlogs.map(blog => {
    const extractedDate = blog.replace(repoDir + '/', '').split('/').slice(0, 3).join('/');
    return new Date(extractedDate).toUTCString();
  });

  // Get URLs for all blogs
  const urls = allBlogs.map(blog => blog.replace(repoDir, githubURLPrefix));

  // Generate rss entries for all blogs
  const rssItems: string[] = [];
  for (let i = 0; i < postInfo.length; i++) {
    rssItems.push(generateRSSItem(postInfo[i], urls[i], dates[i]));
  }

  const rssBlogEntries = rssItems.join('\n');
  const rssFeed = rssTemplate.replace('{blog_entries}', rssBlogEntries);

  await fs.writeFile(feedPath, rssFeed, 'utf-8');
}

main();