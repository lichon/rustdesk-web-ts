import TerminalComponent from './components/Terminal'

function App() {
  const backend = '//localhost:1122/ws'
  return <TerminalComponent backend={backend} />
}

export default App
