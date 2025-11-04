/// <reference path="./manga-provider.d.ts" />
/// <reference path="./core.d.ts" />

class Provider {
  // API Configuration
  private readonly baseUrl = "https://api.weebdex.org"
  private readonly coverBaseUrl = "https://srv.notdelta.xyz"

  // Request Headers
  private readonly DEFAULT_HEADERS = {
    'Origin': 'https://weebdex.org',
    'Referer': 'https://weebdex.org/',
  }

  getSettings(): Settings {
    return {
      supportsMultiLanguage: true,
      supportsMultiScanlator: true,
    }
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Extracts synonyms from the alt_titles object structure
   * @param altTitles - Object with language codes as keys and arrays of titles as values
   * @returns Array of all alternative titles, or undefined if none exist
   */
  private extractSynonyms(altTitles: any): string[] | undefined {
    if (!altTitles || typeof altTitles !== 'object') return undefined

    const synonyms: string[] = []
    for (const lang in altTitles) {
      if (Array.isArray(altTitles[lang])) {
        synonyms.push(...altTitles[lang])
      }
    }

    return synonyms.length > 0 ? synonyms : undefined
  }

  /**
   * Builds a cover image URL from the cover object and manga ID
   * @param cover - Cover object containing id and ext
   * @param mangaId - The manga ID
   * @returns Full URL to the optimized cover image (512.webp), or undefined if cover data is missing
   */
  private buildCoverUrl(cover: any, mangaId: string): string | undefined {
    if (!cover || !cover.id || !cover.ext) return undefined

    // Use 512.webp for optimized size
    return `${this.coverBaseUrl}/covers/${mangaId}/${cover.id}.512.webp`
  }

  // ============================================================
  // Provider Methods
  // ============================================================

  /**
   * Searches for manga based on the provided query
   * @param opts Query options containing the search term and optional filters
   * @returns Array of search results with manga metadata
   */
  async search(opts: QueryOptions): Promise<SearchResult[]> {
    try {
      const params = new URLSearchParams({
        title: opts.query || '',
        limit: '24',
        page: '1',
        sort: 'relevance',
      })

      // Add year filter if provided
      if (opts.year) {
        params.append('yearFrom', opts.year.toString())
        params.append('yearTo', opts.year.toString())
      }

      const url = `${this.baseUrl}/manga?${params.toString()}`
      const response = await fetch(url, { headers: this.DEFAULT_HEADERS })

      if (!response.ok) {
        throw new Error(`Search request failed with status ${response.status}`)
      }

      const result = await response.json()
      const mangaList = result?.data || []
      const results: SearchResult[] = []

      for (const manga of mangaList) {
        if (!manga) continue

        results.push({
          id: manga.id,
          title: manga.title || "Unknown",
          synonyms: this.extractSynonyms(manga.alt_titles),
          image: this.buildCoverUrl(manga.relationships?.cover, manga.id),
          year: manga.year || undefined,
        })
      }

      return results
    } catch (error) {
      console.error('Search failed:', error)
      return []
    }
  }

  /**
   * Retrieves all chapters for a specific manga
   * @param mangaId The unique identifier for the manga
   * @returns Array of chapter details with pagination handling
   */
  async findChapters(mangaId: string): Promise<ChapterDetails[]> {
    try {
      const chapters: ChapterDetails[] = []
      let page = 1
      let hasMore = true

      // Fetch all pages (Weebdex paginates chapters with max 100 per page)
      while (hasMore) {
        const url = `${this.baseUrl}/manga/${mangaId}/chapters?page=${page}&limit=100&order=asc`
        const response = await fetch(url, { headers: this.DEFAULT_HEADERS })

        if (!response.ok) {
          throw new Error(`Failed to fetch chapters page ${page} with status ${response.status}`)
        }

        const result = await response.json()
        const chapterList = result?.data || []

        for (const ch of chapterList) {
          if (!ch) continue

          // Extract scanlator groups
          const groups = ch.relationships?.groups || []
          const scanlator = groups.length > 0
            ? groups.map((g: any) => g.name).join(', ')
            : undefined

          // Build chapter title
          const chapterNum = ch.chapter || ''
          const chapterTitle = ch.title
            ? `Chapter ${chapterNum} - ${ch.title}`
            : `Chapter ${chapterNum}`

          chapters.push({
            id: ch.id,
            url: `https://weebdex.org/chapter/${ch.id}`,
            title: chapterTitle,
            chapter: chapterNum,
            index: chapters.length,
            language: ch.language || undefined,
            scanlator,
            updatedAt: ch.published_at || ch.created_at || undefined,
          })
        }

        // Check if there are more pages
        hasMore = chapterList.length === 100
        page++
      }

      return chapters
    } catch (error) {
      console.error('Failed to fetch chapters:', error)
      return []
    }
  }

  /**
   * Retrieves all pages for a specific chapter
   * @param chapterId The unique identifier for the chapter
   * @returns Array of chapter pages with constructed URLs
   */
  async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
    try {
      const url = `${this.baseUrl}/chapter/${chapterId}`
      const response = await fetch(url, { headers: this.DEFAULT_HEADERS })

      if (!response.ok) {
        throw new Error(`Failed to fetch chapter pages with status ${response.status}`)
      }

      const result = await response.json()

      // Use data_optimized (WebP) if available, fallback to data
      const pageData = result.data_optimized && result.data_optimized.length > 0
        ? result.data_optimized
        : result.data || []

      const node = result.node // e.g., "https://s11.notdelta.xyz"

      if (!node) {
        throw new Error('Chapter node URL is missing')
      }

      const pages: ChapterPage[] = pageData.map((page: any, index: number) => ({
        url: `${node}/data/${chapterId}/${page.name}`,
        index,
        headers: this.DEFAULT_HEADERS,
      }))

      return pages
    } catch (error) {
      console.error('Failed to fetch chapter pages:', error)
      return []
    }
  }
}
