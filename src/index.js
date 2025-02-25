/**
 * @author Kuitos
 * @homepage https://github.com/kuitos/
 * @since 2018-08-15 11:37
 */

import processTpl, { genLinkReplaceSymbol } from './process-tpl';
import { getGlobalProp, getInlineCode, noteGlobalProps } from './utils';

const styleCache = {};
const scriptCache = {};
const embedHTMLCache = {};
if (!window.fetch) {
	throw new Error('There is no fetch on the window env, You can get polyfill in https://polyfill.io/ or the other ways');
}
const defaultFetch = window.fetch.bind(window);

function defaultGetDomain(url) {
	try {
		// URL 构造函数不支持使用 // 前缀的 url
		const href = new URL(url.startsWith('//') ? `${location.protocol}${url}` : url);
		return href.origin;
	} catch (e) {
		return '';
	}
}

function defaultGetTemplate(tpl) {
	return tpl;
}

/**
 * convert external css link to inline style for performance optimization
 * @param template
 * @param styles
 * @param opts
 * @return embedHTML
 */
function getEmbedHTML(template, styles, opts = {}) {
	const { fetch = defaultFetch } = opts;
	let embedHTML = template;

	return getExternalStyleSheets(styles, fetch)
		.then(styleSheets => {
			embedHTML = styles.reduce((html, styleSrc, i) => {
				html = html.replace(genLinkReplaceSymbol(styleSrc), `<style>/* ${styleSrc} */${styleSheets[i]}</style>`);
				return html;
			}, embedHTML);
			return embedHTML;
		});
}

// for prefetch
export function getExternalStyleSheets(styles, fetch = defaultFetch) {
	return Promise.all(styles.map(styleLink => {
			if (styleLink.startsWith('<')) {
				// if it is inline style
				return getInlineCode(styleLink);
			} else {
				// external styles
				return styleCache[styleLink] ||
					(styleCache[styleLink] = fetch(styleLink).then(response => response.text()));
			}

		},
	));
}

// for prefetch
export function getExternalScripts(scripts, fetch = defaultFetch) {
	return Promise.all(scripts.map(script => {
			if (script.startsWith('<')) {
				// if it is inline script
				return getInlineCode(script);
			} else {
				// external script
				return scriptCache[script] ||
					(scriptCache[script] = fetch(script).then(response => response.text()));
			}
		},
	));
}

export function execScripts(entry, scripts, proxy = window, opts = {}) {
	const { fetch = defaultFetch } = opts;

	return getExternalScripts(scripts, fetch)
		.then(scriptsText => {

			window.proxy = proxy;
			const geval = eval;

			function exec(scriptSrc, inlineScript, resolve) {

				const markName = `Evaluating script ${scriptSrc}`;
				const measureName = `Evaluating Time Consuming: ${scriptSrc}`;

				if (process.env.NODE_ENV === 'development') {
					performance.mark(markName);
				}

				if (scriptSrc === entry) {
					noteGlobalProps();

					try {
						// bind window.proxy to change `this` reference in script
						geval(`;(function(window){;${inlineScript}\n}).bind(window.proxy)(window.proxy);`);
					} catch (e) {
						console.error(`error occurs while executing the entry ${scriptSrc}`);
						throw e;
					}

					const exports = proxy[getGlobalProp()] || {};
					resolve(exports);

				} else {
					try {
						// bind window.proxy to change `this` reference in script
						geval(`;(function(window){;${inlineScript}\n}).bind(window.proxy)(window.proxy);`);
					} catch (e) {
						console.error(`error occurs while executing ${scriptSrc}`);
						throw e;
					}

				}

				if (process.env.NODE_ENV === 'development') {
					performance.measure(measureName, markName);
					performance.clearMarks(markName);
					performance.clearMeasures(measureName);
				}
			}

			function schedule(i, resolvePromise) {

				if (i < scripts.length) {
					const scriptSrc = scripts[i];
					const inlineScript = scriptsText[i];

					exec(scriptSrc, inlineScript, resolvePromise);
					// resolve the promise while the last script executed and entry not provided
					if (!entry && i === scripts.length - 1) {
						resolvePromise();
					} else {
						schedule(i + 1, resolvePromise);
					}
				}
			}

			return new Promise(resolve => schedule(0, resolve));
		});
}

export default function importHTML(url, opts = {}) {
	let fetch = defaultFetch;
	let getDomain = defaultGetDomain;
	let getTemplate = defaultGetTemplate;

	// compatible with the legacy importHTML api
	if (typeof opts === 'function') {
		fetch = opts;
	} else {
		fetch = opts.fetch || defaultFetch;
		getDomain = opts.getDomain || defaultGetDomain;
		getTemplate = opts.getTemplate || defaultGetTemplate;
	}

	return embedHTMLCache[url] || (embedHTMLCache[url] = fetch(url)
		.then(response => response.text())
		.then(html => {

			const domain = getDomain(url);
			const assetPublicPath = `${domain}/`;
			const { template, scripts, entry, styles } = processTpl(getTemplate(html), domain);

			return getEmbedHTML(template, styles, { fetch }).then(embedHTML => ({
				template: embedHTML,
				assetPublicPath,
				getExternalScripts: () => getExternalScripts(scripts, fetch),
				getExternalStyleSheets: () => getExternalStyleSheets(styles, fetch),
				execScripts: proxy => {
					if(!scripts.length){
						return Promise.resolve();
					}
					return execScripts(entry, scripts, proxy, { fetch });
				},
			}));
		}));
};

export function importEntry(entry, opts = {}) {
	const { fetch = defaultFetch, getDomain = defaultGetDomain, getTemplate = defaultGetTemplate } = opts;

	if (!entry) {
		throw new SyntaxError('entry should not be empty!');
	}

	// html entry
	if (typeof entry === 'string') {
		return importHTML(entry, { fetch, getDomain, getTemplate });
	}

	// config entry
	if (Array.isArray(entry.scripts) || Array.isArray(entry.styles)) {

		const { scripts = [], styles = [], html = '' } = entry;

		return getEmbedHTML(html, styles, { fetch }).then(embedHTML => ({
			template: embedHTML,
			assetPublicPath: '/',
			getExternalScripts: () => getExternalScripts(scripts, fetch),
			getExternalStyleSheets: () => getExternalStyleSheets(styles, fetch),
			execScripts: proxy => {
				if(!scripts.length){
					return Promise.resolve();
				}
				return execScripts(scripts[scripts.length - 1], scripts, proxy, { fetch });
			},
		}));

	} else {
		throw new SyntaxError('entry scripts or styles should be array!');
	}
}
