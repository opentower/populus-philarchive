import { h, createRef, Component } from 'preact'
import * as Icon from './icons.js'
import './styles/paperSearch.css'

export default class PaperSearch extends Component {
  handleSubmit = async e => {
    e.preventDefault()
    const formdata = new FormData(this.searchForm.current)
    const query = Array.from(formdata.entries())[0][1]
    this.setState({query}, _ => this.getPage(0))
  }

  getPage = async num => {
    this.setState({querying:true})
    const queryTerms = this.state.query.split(/\s+|[^a-zA-Z]/) // split terms to mirror tokenizer
    const results = await fetch(`https://oai.open-tower.com/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          AND: queryTerms
        },
        opts: { 
          PAGE: {
            NUMBER: num, 
            SIZE: 5
          },
          DOCUMENTS: true
        }
      })
    }).then(stream => stream.json())
    console.log(results)
    this.setState({results, querying:false, page: num})
  }

  nextPage = _ => {
    if (this.nextAvailable()) {
      this.getPage(this.state.page + 1)
    }
  }

  nextAvailable = _ => (this.state.page + 1) * 5 < this.state.results.RESULT_LENGTH

  prevPage = _ => {
    if (this.prevAvailable()) {
      this.getPage(this.state.page - 1)
    }
  }

  prevAvailable = _ => this.state.page > 0

  clearResults = _ => this.setState({query:null, page:null, results:null})

  searchForm = createRef()

  render(props, state) {
    return state.results 
      ? <div>
          <div>
            <span>Query: {state.query}</span>
            <button onclick={this.clearResults} class="paper-search-nav-button">{Icon.close}</button>
          </div>
          <div>
            <span>Showing: {((state.page + 1) * 5) - 4}-{Math.min((state.page + 1) * 5), state.results.RESULT_LENGTH} of {state.results.RESULT_LENGTH}</span>
            <button disabled={!this.prevAvailable()} onClick={this.prevPage} class="paper-search-nav-button">«</button>
            <button disabled={!this.nextAvailable()} onClick={this.nextPage} class="paper-search-nav-button">»</button>
          </div>
          <ol start={((state.page) * 5) + 1} id="query-results" data-querying={state.querying}>
            {state.results.RESULT.map(rslt => <li>
              <a class="paper-search-title"onclick={_ => props.setPaper(rslt._id)}>{rslt._doc.title}</a>
              <div class="paper-search-creators">{
                rslt._doc.creator.map
                  ? rslt._doc.creator.map(creator => <span class="paper-search-creator">{creator}</span>)
                  : <span class="paper-search-creator">{rslt._doc.creator}</span>
              }</div>
            </li>)}
          </ol>
      </div>
      : <form class="application-form" onSubmit={this.handleSubmit} ref={this.searchForm}>
        <label htmlFor="archive-query">Philarchive Query</label>
        <input key="query" name="archive-query"></input>
        <button class="styled-button">Look Up Paper</button>
      </form>
  }
}

function SearchResult(props) {
  return <div class="search-result">
    <div class="search-result-name">
      <a href={`https://opentower.github.io/populus-viewer/#/${encodeURIComponent(props.result.canonical_alias.slice(1))}`}>
        {props.result.name}
      </a>
    </div>
    <div class="search-result-data">
      {props.result.num_joined_members === 1 
        ? <span class="search-result-members">1 member</span>
        : <span class="search-result-members">{props.result.num_joined_members} members</span>
      }
      {props.result.join_rule === "public"
        ? <span>public</span>
        : <span>invite-only</span>
      }
      {
      props.result.world_readable
        ? <span>world-readable</span>
        : null
      }
    </div>
    <div class="search-result-topic">
      {props.result.topic ? props.result.topic : "no topic specified"}
    </div>
  </div>
}
