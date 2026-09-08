import { describe, expect, it } from 'vitest'
import { parsearNoticias } from '../../src/externo/noticiasFantasy.js'

describe('noticias de FútbolFantasy', () => {
  it('conserva únicamente los datos publicados y clasifica por su icono', () => {
    const html = `<div class="noticia">
      <div class="date">08/09</div> <img class="icon" src="https://static.futbolfantasy.com/icono_big_lesion.png" />
      <a class="link" href="https://www.futbolfantasy.com/laliga/noticias/123-parte-medico">Parte m&eacute;dico &amp; evoluci&oacute;n</a>
    </div>`
    expect(parsearNoticias(html)).toEqual([{
      fecha: '08/09',
      titulo: 'Parte médico & evolución',
      url: 'https://www.futbolfantasy.com/laliga/noticias/123-parte-medico',
      categoria: 'lesión',
    }])
  })
})
