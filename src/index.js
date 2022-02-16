import { h, render, Fragment, createRef, Component } from 'preact'
import LoginView from './login.js'
import PaperSearch from './paperSearch.js'
import Client from './client.js'
import { mscResourceData, spaceChild }from './constants.js'
import './styles/global.css'
import './styles/applicationView.css'

class PopulusPhilArchive extends Component {
  constructor () {
    super()
    this.state = {
      initializationStage: "connecting to database",
      loggedIn: true
      // the presumption is that we're logged in until it's clear that we're
      // not. This avoids flashing the login view while verifying that we're
      // logged in.
    }
    const queryParameters = new URLSearchParams(window.location.search)
    this.loginToken = queryParameters.get('loginToken')

    if (Client.isResumable()) Client.initClient().then(this.loginHandler)
    else if (this.loginToken) {
      Client.initClient()
        .then(_ => Client.client.loginWithToken(this.loginToken, this.loginHandler))
        .then(_ => window.history.replaceState({}, '', location.pathname + location.hash)) // clear query parameters
    } else this.setState({ loggedIn: false })
  }

  setInitializationStage = s => this.setState({ initializationStage: s })

  logoutHandler = _ => {
    localStorage.clear()
    Client.restart()
    this.setState({ loggedIn: false })
  }

  loginHandler = _ => {
    Client.client.on("Session.logged_out", this.logoutHandler)
    localStorage.setItem('accessToken', Client.client.getAccessToken())
    localStorage.setItem('userId', Client.client.getUserId())
    Client.client.startClient().then(_ => {
      this.setState({
        initializationStage: "performing initial sync",
        loggedIn: true
      })
    })
  }

  render (_props, state) {
    if (!state.loggedIn) return <LoginView loginHandler={this.loginHandler} />
    return <ApplicationView />
  }
}

class ApplicationView extends Component {
  creationForm = createRef()

  setPaper = async entryRaw => {
    console.log(entryRaw)
    const split = entryRaw.split("/")
    const entry = split[split.length - 1]
    try {
      const rslt = await fetch(`https://via.open-tower.com/https://philarchive.org/oai.pl?verb=GetRecord&identifier=oai:philarchive.org/rec/${entry}`)
      .then(this.renderOpenArchiveXML)
      .then(paper => this.setState({paper, entry}))
    } catch (err) {
      const rslt = await fetch(`https://via.open-tower.com/https://philarchive.org/item.pl?id=${entry}&format=txt`)
      .then(this.renderFallback)
      .then(paper => this.setState({paper, entry}))
    }
    await this.checkDownload(entry)
    this.getRooms(entry)
  }

  async checkDownload(entry) {
    const response = await fetch(`https://via.open-tower.com/https://philarchive.org/archive/${entry}`, {
      method: "HEAD"
    })
    this.setState({contentType: response.headers.get("content-type") })
  }

  async renderFallback(rslt) {
    const text = await rslt.text()
    return <Fragment>
      <h3>{text}</h3>
      <div class="paper-description">
        Sorry, there's no open-archive record for this paper, so I can't find
        a description or structured bibliographic information. Maybe this paper isn't open access?
      </div>
    </Fragment>
  }

  async renderOpenArchiveXML(rslt) {
    const text = await rslt.text()
    const parser = new DOMParser()
    const xmldoc = parser.parseFromString(text, "text/xml")
    const resolver = xmldoc.createNSResolver(xmldoc)
    const title = xmldoc
      .evaluate("//dc:title", xmldoc, resolver, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      .singleNodeValue
      .textContent
    const date = xmldoc
      .evaluate("//dc:date", xmldoc, resolver, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      .singleNodeValue
      .textContent
    const authors = []
    const authorIterator = xmldoc
      .evaluate("//dc:creator", xmldoc, resolver, XPathResult.UNORDERED_NODE_ITERATOR_TYPE, null)
    let author = authorIterator.iterateNext()
    while (author) {
      authors.push(author.textContent)
      author = authorIterator.iterateNext()
    }
    const description = xmldoc
      .evaluate("//dc:description", xmldoc, resolver, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      .singleNodeValue
      .textContent
    return <Fragment>
      <h3 class="paper-title">{title}</h3>
      <h5 class="paper-authors">
        {authors.map(author => <span>{author}</span>)}
      </h5>
      <h5 class="paper-date">{date}</h5>
      <div class="paper-description">{description}</div>
    </Fragment>
  }

  getRooms = async _ => {
    const results = await Client.client.publicRooms({
      limit:10,
      filter: {
        generic_search_term: this.state.entry
      }
    })
    this.setState({results: results.chunk})
  }

  createDiscussion = async e => {
    e.preventDefault()
    const identifier = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 8)
    const formdata = new FormData(this.creationForm.current)
    const theName = Array.from(formdata.entries())[0][1]
    const theTopic = Array.from(formdata.entries())[1][1]
    await Client.client.createRoom({
      room_alias_name: `philarchive-discussion-${this.state.entry}-${identifier}`,
      visibility: "public",
      name: theName,
      topic: theTopic,
      // We declare the room a space
      creation_content: {
        type: "m.space",
        [mscResourceData]: {
          url: `https://via.open-tower.com/https://philarchive.org/archive/${this.state.entry}`,
          mimetype: "application/pdf",
        }
      },
      initial_state: [
        // we allow anyone to join, by default, for now
        {
          type: "m.room.join_rules",
          state_key: "",
          content: {join_rule: "public"}
        }
      ],
      power_level_content_override: {
        events: {
          // we allow anyone to annotate, by default, for now
          [spaceChild]: 0
        }
      }
    }).then(setTimeout(this.getRooms,1000)).catch(alert)
  }

  toggleCreation = _ => this.setState(oldState => { return {creation: !oldState.creation} })

  render(props, state) {
    return <div id="application-view">
      <div id="application-content">
        <div id="available-discussions">
          {state.entry
            ? <h2 id="entry-code">{state.entry}</h2>
            : null
          }
          {state.paper ? state.paper : <h3 class="paper-info">No Paper Selected</h3> }
          <div class="discussion-listing">
            {state.contentType === "application/pdf" 
              ? <Fragment>
                <h5>Current Discussions:</h5>
                {state.results?.length 
                  ? state.results.map(result => <SearchResult result={result}/>)
                  : <div class="empty-result">No discussions found</div>
                }
              </Fragment>
              : state.paper 
                ? "Couldn't locate a PDF for this record"
                : "Select a paper to begin"
            }
        </div>
        {state.entry && state.paper && state.contentType === "application/pdf"
          ? <button onclick={this.toggleCreation} id="new-discussion">+ Create a New Discussion of {state.entry}</button>
          : null
        }
        </div>
        <hr style="width:100%" />
        {!state.creation 
          ? <PaperSearch setPaper={this.setPaper} />
          : <form class="application-form" onSubmit={this.createDiscussion} ref={this.creationForm}>
            <label htmlFor="roomName">Discussion Name</label>
            <input key="roomName" name="roomName"></input>
            <label htmlFor="roomTopic">Discussion Topic</label>
            <textarea name="roomTopic"></textarea>
            <button class="styled-button">Create Discussion</button>
          </form>
        }
      </div>
    </div>
  }
}


function recaptchaHandler (recaptchaToken) {
  window.dispatchEvent(new CustomEvent('recaptcha', { detail: recaptchaToken }))
}

window.recaptchaHandler = recaptchaHandler // needs to be global for the google callback

render(<PopulusPhilArchive />, document.body)
