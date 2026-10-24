<?xml version="1.0" encoding="UTF-8"?>
<!-- Human-readable view of the sitemaps in a browser. Crawlers ignore this stylesheet. -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="en"><head><meta charset="utf-8"/><title>Sitemap · Noticiero VOID</title>
      <style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#f4f4f6}a{color:#5b21b6}</style></head>
    <body><h1>Noticiero VOID sitemap</h1>
      <p>XML sitemap for search engines (sitemaps.org protocol). <xsl:value-of select="count(s:sitemapindex/s:sitemap | s:urlset/s:url)"/> entries.</p>
      <table><tr><th>URL</th><th>Last modified / published</th></tr>
        <xsl:for-each select="s:sitemapindex/s:sitemap | s:urlset/s:url">
          <tr><td><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></td>
            <td><xsl:value-of select="s:lastmod"/><xsl:value-of select="news:news/news:publication_date"/></td></tr>
        </xsl:for-each>
      </table></body></html>
  </xsl:template>
</xsl:stylesheet>
