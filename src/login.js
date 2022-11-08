import { h, Fragment, createRef, Component } from 'preact';
import './styles/login.css'
import { serverRoot } from './constants.js'
import Client from './client.js'
import * as Matrix from 'matrix-js-sdk'
import * as Icons from './icons.js'

async function discoverServer(domain) {
  let clientConfig = await Matrix.AutoDiscovery.findClientConfig(domain)
  if (clientConfig["m.homeserver"].state !== "SUCCESS") {
      if (!domain.includes("://")) domain = "https://" + domain
      console.log(domain)
      clientConfig = await Matrix.AutoDiscovery.fromDiscoveryConfig({"m.homeserver": { "base_url" : domain }})
  }
  if (clientConfig["m.homeserver"].state !== "SUCCESS") throw Error("failed autodiscovery")
  localStorage.setItem("baseUrl", clientConfig["m.homeserver"].base_url)
}

export default class LoginView extends Component {
  constructor(props) {
    super(props)
    const queryParameters = new URLSearchParams(window.location.search)
    this.state = {
      name: "",
      password: "",
      server: queryParameters.get('server') || ""
    }
  }

  componentDidUpdate() { 
    this.resizeObserver.disconnect()
    this.resizeObserver.observe(this.loginElement.current)
  }

  componentWillUnmount() { this.resizeObserver.disconnect() }

  switchView = switchTo => (e) => {
    if (e) e.preventDefault()
    this.setState({registering: switchTo})
  }

  setServer = (server, callback) => this.setState({ server }, callback)

  setName = name => this.setState({ name })

  setPassword = password => this.setState({ password})

  loginWrapper = createRef()

  loginElement = createRef()

  resizeObserver = new ResizeObserver(_ => this.resize())

  resize = _ => { this.loginWrapper.current.style.height = `${this.loginElement.current.scrollHeight}px` }

  render(props, state) {
    const theProps = {
      setServer: this.setServer,
      server: state.server,
      setName: this.setName,
      name: state.name,
      setPassword: this.setPassword,
      password: state.password,
      loginHandler: props.loginHandler,
      switchView: this.switchView,
      loginElement: this.loginElement,
    }
    const mainCard = state.registering === "register"
      ? <Registration {...theProps} />
      : <Login {...theProps} />
      return <div id="login-container"><div id="login-wrapper" ref={this.loginWrapper}>{mainCard}</div></div>
  }
}

class Login extends Component {
  constructor(props) {
    super(props)
    const queryParameters = new URLSearchParams(window.location.search)
    this.state = {
      SSOProviders: [],
      loading: false
    }
    if (this.props.server && queryParameters.get("sso")) {
      this.doingSSO = true
      this.trySSO(queryParameters.get("sso"), queryParameters.get("server"))
    }
  }

  componentDidMount() {
    if (this.props.server) this.queryServers()
  }

  handleSubmit = e => {
    e.preventDefault()
    this.setState({submitting: true});

    (this.props.server 
        ? discoverServer(this.props.server)
        : Promise.resolve(localStorage.setItem("baseUrl", serverRoot))
    ).then(() => Client.initClient())
     .then(client => client.loginWithPassword(this.props.name.toLowerCase(), this.props.password))
     .then(this.props.loginHandler)
     .catch(e => {
       this.setState({submitting: false})
       window.alert(e)
     })
  }

  queryServers = _ => {
    // we spawn a control token here to be sure to only mark things as failed
    // if there's not another query already going
    const flowControlToken = {}
    this.flowControl = flowControlToken;

    (this.props.server 
        ? discoverServer(this.props.server)
        : Promise.resolve(localStorage.setItem("baseUrl", serverRoot))
    ).then(() => Client.initClient())
     .then(client => client.loginFlows())
     .then(this.handleFlows)
     .catch(() => this.flowControl === flowControlToken 
       ? this.setState({ loading: "failed"}) 
       : null)
  }

  handleFlows = flows => {
    const theSSO = flows.flows.find(flow => flow.type === "m.login.sso")
    if (!theSSO) {
      this.setState({ loading: null})
      return
    }
    this.setState({
      loading: null,
      SSOProviders: theSSO.identity_providers
    })
  }


  trySSO = (idpId, server, e) => {
    e?.preventDefault();

    (server ? discoverServer(server) : Promise.resolve(null))
      .then(() => Client.client || Client.initClient())
      .then(client => window.location.replace(client.getSsoLoginUrl(window.location.href, "sso", idpId)))
  }

  setServer = v => {
    clearTimeout(this.serverTimeout)
    if (v.match(/[^/]*\.[^/]*/) || v === "") {
      this.setState({
        SSOProviders: [],
        loading: "loading"
      })
      this.props.setServer(v, _ => {
        this.serverTimeout = setTimeout(this.queryServers, 200)
      })
    } else {
      this.props.setServer(v)
      this.setState({
        SSOProviders: [],
        loading: v.length > 0 ? "badurl" : null
      })
    }
  }

  canSubmit = _ => {
    if (this.state.loading) return false
    if (this.props.password.length < 8) return false
    if (/[^a-zA-Z0-9._=/]/.test(this.props.name)) return false
    return true
  }

  render(props, state) {
    const connectionMessage = state.loading === "loading"
      ? "loading server information..."
      : state.loading === "failed"
      ? "couldn't connect to server"
      : state.loading === "badurl"
      ? "the server name should look like 'matrix.org'"
      : null
    if (this.doingSSO) return <div id="login-sso-loader">Redirecting...</div>
    return <div ref={props.loginElement} id="login">
      <h3>Login To Populus-Philarchive</h3>
      <p id="login-info">This is a discussion overlay for philarchive, using <a href="https://opentower.github.io/populus-viewer">populus</a>. You can log in with any matrix account.</p>
      <form id="loginForm" onSubmit={this.handleSubmit}>
        <UserData
          connectionMessage={connectionMessage}
          setServer={this.setServer}
          server={props.server}
          setPassword={props.setPassword}
          password={props.password}
          setName={props.setName}
          name={props.name} />
        <div>
          <button disabled={!this.canSubmit()} class="styled-button" >Login</button>
        </div>
      </form>
      {state.SSOProviders.length > 0 
        ? <Fragment>
            <h4>Or, login via:</h4>
            <div id="login-sso-providers">
              {
                state.SSOProviders.map(
                  provider => {
                    let iconHttpURI = null
                    if (provider.icon) iconHttpURI = Matrix.getHttpUriForMxc(localStorage.getItem("baseUrl"), provider.icon, 40, 40, "crop")
                    return <div
                    onclick={e => this.trySSO(provider.id, null, e)}
                    class="login-sso-listing"
                    key={provider.id} >
                      { iconHttpURI
                        ? <img class="sso-icon" width="40" height="40" src={iconHttpURI} />
                        : Icons.login
                      }
                      <a class="sso-name" href={`?server=${encodeURIComponent(props.server)}&sso=${encodeURIComponent(provider.id)}`}>
                      {provider.name}
                      </a>
                      </div>
                  })
              }
            </div>
          </Fragment>
          : null
        }
      <div id="login-options">
        <hr class="styled-rule" />
        <span>Don't have an account? </span>
        <a disabled={state.submitting} onClick={props.switchView("register")} >Register</a>
      </div>
    </div>
  }
}

class Registration extends Component {
  constructor (props) {
    super(props)
    this.state = {
      registrationStage: "awaiting-server"
    }
    this.recaptchaHandler = this.recaptchaHandler.bind(this)
  }

  componentDidMount() { window.addEventListener('recaptcha', this.recaptchaHandler) }

  componentWillUnmount() { window.removeEventListener('recaptcha', this.recaptchaHandler) }

  beginRegistrationFlow = async e => {
    e.preventDefault()
    this.setState({ registrationStage: "retrieving-auth" })
    if (this.props.server) await discoverServer(this.props.server)
    else localStorage.setItem("baseUrl", serverRoot)

    await Client.initClient()
    try {
      await Client.client.register(this.props.name.toLowerCase(), this.props.password, undefined, {})
    } catch (err) {
      if (err.data?.session && err.data.params["m.login.recaptcha"]) {
        console.log(err.data)
        this.authSession = err.data.session
        this.recaptchaKey = err.data.params["m.login.recaptcha"].public_key
        this.setState({ registrationStage: "awaiting-recaptcha" })
      } else {
        switch (err.name) {
          // should analyze for other errors here.
          case "ConnectionError" : {
            alert(`Tried to connect to a server at ${Client.client.getHomeserverUrl()} Double-check that address?`)
            break
          }
          case "M_USER_IN_USE" : {
            alert(`Sorry, the name ${this.props.name} is already in use at ${Client.client.getDomain()}. Try a different name or server?`)
            break
          }
          default : alert(`Something went wrong... Here's the error:\n\n${err.name}: ${err.message}`)
        }
        this.setState({ registrationStage: "awaiting-server" })
      }
    }
  }

  recaptchaHandler = e => {
    e.preventDefault()
    this.setState({ registrationStage: "registering" })
    Client.client.register(this.props.name.toLowerCase(), this.props.password, this.authSession, {
      type: "m.login.recaptcha",
      response: e.detail
    }).catch(this.handleDummy)
      .then(_ => Client.client.loginWithPassword(this.props.name.toLowerCase(), this.props.password))
      .then(this.props.loginHandler)
      .catch(window.alert)
  }

  canSubmit = _ => {
    if (this.props.password.length < 8) return false
    if (/[^a-zA-Z0-9._=/]/.test(this.props.name)) return false
    return true
  }

  handleDummy = err => {
    console.log(err.data)
    const dummyAvailable = data => {
      if (data.flows && data.completed) {
        return data.flows.some(flow => {
          const remaining = flow.stages.filter(x => !data.completed.includes(x))
          return remaining.length === 1 && remaining.includes("m.login.dummy")
        })
      }
      return false
    }
    if (dummyAvailable(err.data)) {
      return Client.client.register(this.props.name.toLowerCase(), this.password, this.authSession, {
        type: "m.login.dummy"
      })
    }
    throw new Error("Error: can't complete this registration flow")
  }

  render(props, state) {
    switch (state.registrationStage) {
      case "retrieving-auth" : {
        return <div ref={props.loginElement} id="registration">
          <div id="registeringFeedback">Retrieving Authentication Procedures...</div>
        </div>
      }
      case "registering" : {
        return <div ref={props.loginElement} id="registration">
          <div id="registeringFeedback">Registering Account...</div>
        </div>
      }
      case "awaiting-recaptcha" : {
        return <div ref={props.loginElement} id="registration">
          <form id="registerForm">
            <div id="theRecaptcha">
              Complete this Recaptcha to finish registration
              <div class="g-recaptcha"
                data-sitekey={this.recaptchaKey}
                data-callback="recaptchaHandler" />
            </div>
            <hl style="styled-rule" />
            <div>OR, <button class="styled-button" onClick={props.switchView("login")} >Login With Existing Account</button></div>
            <script src="https://www.google.com/recaptcha/api.js" async defer />
          </form>
        </div>
      }
      case "awaiting-server" : {
        return <div ref={props.loginElement} id="registration">
          <h3>Register an account</h3>
          <form
            onSubmit={this.beginRegistrationFlow}
            id="registerForm">
            <UserData
              newAccount={true}
              setServer={props.setServer}
              server={props.server}
              setPassword={props.setPassword}
              password={props.password}
              setName={props.setName}
              name={props.name} />
            <div><button disabled={!this.canSubmit()} class="styled-button">Register a New Account</button></div>
            <div id="login-options">
              <hr class="styled-rule" />
              <span>Already have an account? </span>
              <a onClick={props.switchView("login")} >
                Login With Existing Account
              </a>
            </div>
          </form>
        </div>
      }
    }
  }
}

class UserData extends Component {
  usernameInput = createRef()

  passwordInput = createRef()

  validateUsername = (e) => {
    this.props.setName(e.target.value)
    if (/[^a-zA-Z0-9._=/]/.test(e.target.value)) {
      this.usernameInput.current.setCustomValidity("Bad Character")
      this.setState({usernameMessage: "Usernames can include only a-z, 0-9, =, _ or '.'"})
    } else {
      this.usernameInput.current.setCustomValidity("")
      this.setState({usernameMessage: null})
    }
  }

  validatePassword = e => {
    this.props.setPassword(e.target.value)
    if (e.target.value.length < 8 && e.target.value.length > 0) {
      this.passwordInput.current.setCustomValidity("Bad Password")
      this.setState({passwordMessage: "Passwords must be at least 8 characters"})
    } else {
      this.passwordInput.current.setCustomValidity("")
      this.setState({passwordMessage: null})
    }
  }

  handleFocus = e => {window.innerHeight < 450 && e.target.scrollIntoView({block: "center"})}

  handleServerInput = e => this.props.setServer(e.target.value)

  render (props, state) {
    return (
      <Fragment>
        <label htmlFor="servername">Server</label>
        <input class="styled-input" value={props.server} onfocus={this.handleFocus} oninput={this.handleServerInput} type="text" id="servername" name="servername" placeholder="populus.open-tower.com" />
        <div class="userdata-form-info">{props.connectionMessage}</div>
        <label htmlFor="username">Username</label>
        <input class="styled-input" autocomplete="username" value={props.name} onfocus={this.handleFocus} onInput={this.validateUsername} type="text" ref={this.usernameInput} id="username" name="username" />
        <div class="userdata-form-info">{state.usernameMessage}</div>
        <label htmlFor="password">Password</label>
        <input class="styled-input" autocomplete={props.newAccount ? "new-password" : "current-password"} onfocus={this.handleFocus} value={props.password} oninput={this.validatePassword} type="password" ref={this.passwordInput} id="password" name="password" />
        <div class="userdata-form-info">{state.passwordMessage}</div>
      </Fragment>
    )
  }
}
