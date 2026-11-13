import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {
  BOOKS_DIR,
  LIBRARY_FILE,
  MAPS_FILE,
  THREADS_FILE,
  saveLibrary,
  saveMaps,
  saveThreads,
  writeJson,
} from './store.js';
import { finalizeContent } from './parsers.js';

const DEMO_CHAPTERS = [
  {
    title: '我们不是没有时间，而是没有注意力',
    html: `
      <p>每个周末，我都在书架前站一会儿。那些没有读完的书像一扇扇半开的门，提醒我：问题也许不在于时间太少，而在于注意力总被更响的东西带走。</p>
      <p>我们习惯把阅读算进“待办事项”：一年五十本、每天三十页、通勤路上听完一本书。数字让阅读看起来可控，却常常把它变成另一场追赶。真正被消耗掉的，不是页数，而是坐下来、把心放慢的那十分钟。</p>
      <blockquote><p>阅读不是把文字从纸上搬进脑子，而是允许一个陌生的声音，在自己的生活里停留得久一点。</p></blockquote>
      <p>慢读不是故意拖延。它只是承认：理解有它自己的速度。一个概念要和生活经验咬合，一句好话要在心里回响，才可能真正留下。</p>
    `,
  },
  {
    title: '阅读是一种缓慢的建造',
    html: `
      <p>有一年冬天，我反复读一本薄薄的随笔集。第一遍只记住了几句话，第二遍开始看见作者藏在段落之间的犹豫，第三遍时，我忽然明白他真正想说的并不是答案，而是如何与没有答案的日子相处。</p>
      <p>书没有变，是我在两次阅读之间多活了一段人生。慢读的意义，大概就在这里：它允许书和人一起变化。</p>
      <p>如果把阅读看成建造，那么摘抄是砖，提问是梁，重读是回访。一次读完不是竣工，而只是打下了地基。很多书要在几年后重新打开，才知道它当初把什么种在了我们身上。</p>
      <p>所以不必急着“读完”。读到一个地方卡住了，就停一停，看看是什么让你卡住。那往往比下一页更重要。</p>
    `,
  },
  {
    title: '把一本书读成一张地图',
    html: `
      <p>面对一本结构复杂的书，我习惯先画出它的骨架：作者想解决什么问题？分了哪几步？哪一章是转折？哪些例子只是装饰？这张地图不必漂亮，甚至不必给别人看，它的作用是让我在细节里迷路时，知道自己在哪。</p>
      <p>思维导图适合做这件事，但前提是节点足够克制。把整段话抄上去，只是把线性的文字搬成了放射状；真正的提炼，是找到概念之间的关系，然后用自己的话给它命名。</p>
      <p>我常把地图分成三层：最中间是问题，第二层是作者的回答，最外面是我的疑问。前两层属于书，最外面那一层才属于我。</p>
    `,
  },
  {
    title: '让笔记回到问题本身',
    html: `
      <p>很多笔记最后无人回看，不是因为记得不够多，而是因为记的全是“书说了什么”，没有“这和我有什么关系”。前者是存档，后者才是对话。</p>
      <p>一个有用的办法是：每读完一节，只写一句话，句子必须以“我”开头。比如“我以前以为专注是靠意志力，现在发现它更像是环境设计的结果。”这样的句子不完整，却带着体温，日后回看时能够重新启动思考。</p>
      <p>另一个办法是给摘录加一个“为什么”。为什么这句话值得留下？它反驳了什么？它让我想起了谁？一个摘录加上三行自己的解释，价值往往超过十页整齐的划线。</p>
      <blockquote><p>笔记不是书的副本，而是你与书相遇之后留下的现场。</p></blockquote>
    `,
  },
  {
    title: '在重读中遇见自己',
    html: `
      <p>重读一本旧书，像回到一间住过的房子。家具还在原来的位置，但窗外的树高了，墙上的光也不同了。你会发现自己当年用铅笔划下的句子，有些依然准确，有些已经显得幼稚。</p>
      <p>这种变化并不令人沮丧，反而是一种确认：我们在移动。阅读最诚实的回报，不是知识清单又长了一行，而是某一天你发现，自己已经能用更平静的语气谈论从前耿耿于怀的事。</p>
      <p>所以，与其追求读得多，不如留下几本愿意一读再读的书。它们会像坐标一样，标出你精神世界里那些缓慢但真实的位移。</p>
    `,
  },
  {
    title: '一份轻量的慢读练习',
    html: `
      <p>如果你愿意试一试，可以从一个很低的门槛开始：每天二十分钟，只读一本书，手机放在另一个房间。读到有感觉的地方，停下来，在页边写一句自己的话。</p>
      <p>一周结束时，把这一周的句子摊开，看看它们之间有没有一条暗线。那条暗线，可能就是你最近真正关心的问题。下周一，带着这个问题继续读。</p>
      <p>不要急着做漂亮的笔记，也不要急着输出。先让阅读恢复它本来的样子：一段不被打断的、与另一个心灵相处的时间。</p>
      <p>当阅读不再是一项需要完成的任务，它才会慢慢变成一种生活。</p>
    `,
  },
];

function buildDemo() {
  const chapters = DEMO_CHAPTERS.map((chapter, index) => ({
    id: `c${index + 1}`,
    title: chapter.title,
    html: chapter.html.trim(),
    text: chapter.html
      .replace(/<[^>]+>/g, '\n')
      .replace(/\n+/g, '\n')
      .trim(),
  }));
  const content = finalizeContent({
    title: '慢读：在注意力稀缺的时代',
    author: '林间',
    format: 'txt',
    chapters,
    sourceType: 'demo',
    meta: { readingTime: 12, demo: true },
  });
  const now = Date.now();
  const book = {
    id: 'demo-slow-reading',
    title: content.title,
    author: content.author,
    format: 'txt',
    sourceType: 'demo',
    sourceUrl: '',
    excerpt: content.excerpt,
    wordCount: content.wordCount,
    chapterCount: content.chapters.length,
    size: 0,
    createdAt: new Date(now - 1000 * 60 * 60 * 24 * 6).toISOString(),
    updatedAt: new Date(now - 1000 * 60 * 60 * 24 * 2).toISOString(),
    lastOpenedAt: new Date(now - 1000 * 60 * 42).toISOString(),
    progress: { chapterIndex: 2, ratio: 0.32, page: 1, updatedAt: new Date(now - 1000 * 60 * 42).toISOString() },
    palette: 0,
    tags: ['示例', '慢读'],
    isDemo: true,
  };
  return { book, content };
}

function node(text, children = []) {
  return { id: crypto.randomUUID().slice(0, 8), text, note: '', children };
}

function buildDemoMap() {
  const now = Date.now();
  return {
    id: 'demo-reading-system',
    title: '如何建立一套轻量的阅读系统',
    bookId: 'demo-slow-reading',
    bookTitle: '慢读：在注意力稀缺的时代',
    createdAt: new Date(now - 1000 * 60 * 60 * 24 * 3).toISOString(),
    updatedAt: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
    theme: 'forest',
    root: node('轻量阅读系统', [
      node('输入', [
        node('围绕问题选书'),
        node('每天 20 分钟'),
        node('手机放到另一个房间'),
      ]),
      node('加工', [
        node('读到卡住处就停'),
        node('摘录 + 三行自己的话'),
        node('把章节画成结构地图'),
      ]),
      node('输出', [
        node('每周整理一条暗线'),
        node('写一张能讲给别人听的卡片'),
      ]),
      node('复利', [
        node('重读留下坐标的书'),
        node('允许观点随人生变化'),
      ]),
    ]),
  };
}

export async function seedIfNeeded() {
  let hasLibrary = true;
  try {
    await fs.access(LIBRARY_FILE);
  } catch {
    hasLibrary = false;
  }
  if (!hasLibrary) {
    const { book, content } = buildDemo();
    await saveLibrary([book]);
    await writeJson(`${BOOKS_DIR}/${book.id}.json`, content);
  }
  try {
    await fs.access(MAPS_FILE);
  } catch {
    await saveMaps([buildDemoMap()]);
  }
  try {
    await fs.access(THREADS_FILE);
  } catch {
    await saveThreads([]);
  }
}
