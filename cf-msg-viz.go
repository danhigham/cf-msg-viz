package main

import (
  "fmt"
  "strings"
  "log"
  "github.com/apcera/nats"
  "path/filepath"
  "net/http"
  "time"
  "encoding/json"
  "strconv"
  "flag"
)

type router_register_msg struct {
  Dea                   string
  App                   string
  Host                  string
  Port                  int
  Uris                  []string
  Private_instance_id   string
  Tags                  map[string]string
}

type dea_advertise_msg struct {
  Id                    string
  Stacks                []string
  Available_memory      int
  Available_disk        int
  App_id_to_count       map[string]int
  Placement_properties  map[string]string
}

type health_manager_health struct {
  Droplets             []map[string]string
}

type staging_advertise_msg struct {
  Id                    string
  Stacks                []string
  Available_memory      int
}

type droplet struct {
  Cc_partition          string
  Droplet               string
  Version               string
  Instance              string
  Index                 int
  State                 string
  State_timestamp       float64
}

type droplet_usage struct {
  Time                  string          `json:"time"`
  Cpu                   float64         `json:"cpu"`
  Mem                   int             `json:"mem"`
  Disk                  int             `json:"disk"`
}

type droplet_stats struct {
  Name                  string          `json:"name"`
  Uris                  []string        `json:"uris"`
  Host                  string          `json:"host"`
  Port                  int             `json:"port"`
  Uptime                int             `json:"uptime"`
  Mem_quota             int             `json:"mem_quota"`
  Disk_quota            int             `json:"disk_quota"`
  Fds_quota             int             `json:"fds_quota"`
  Usage                 droplet_usage   `json:"usage"`
}

type droplet_full struct {
  Dea                   string
  Droplet               string
  Version               string
  Instance              string
  Index                 int
  State                 string
  State_timestamp       float64
  Staged                string
  Stats                 droplet_stats
}

type find_droplet_request struct {
  Droplet               string          `json:"droplet"`
  States                []string        `json:"states"`
  Include_stats         bool            `json:"include_stats"`
  Version               string          `json:"version"`
}

type dea_heartbeat_msg struct {
  Droplets              []*Droplet
  Dea                   string
}

type Droplet struct {
  Id                    string          `json:"id"`
  Cc_partition          string          `json:"-"`
  Droplet               string          `json:"droplet"`
  Version               string          `json:"version"`
  Instance              string          `json:"instance"`
  Index                 int             `json:"index"`
  State                 string          `json:"state"`
  State_timestamp       float64         `json:"state_timestamp"`
  Stats                 droplet_stats   `json:"stats"`
  Dea                   string          `json:"dea"`
}

type DEA struct {
  Id                    string          `json:"id"`
  Ip                    string          `json:"ip"`
  Max_memory            int             `json:"max_memory"`
  Reserved_memory       int             `json:"reserved_memory"`
  Used_memory           int             `json:"used_memory"`
  Droplets              []*Droplet      `json:"droplets"`
  LastSeen              time.Time       `json:"last_seen"`
}

type DEAMap struct {
  DEAs                  map[string]*DEA `json:"deas"`
}

// ==================================================================================

type D3_Node struct {
  Id                   string             `json:"id"`
  Children             []*D3_Node         `json:"children"`
  NodeType             string             `json:"type"`
  Properties           map[string]string  `json:"properties"`
  Parent               string             `json:"parent"`
}


// ==================================================================================

func (deaMap *DEAMap) init(c *nats.EncodedConn) (err error) { //build initial DEA list

  deaMap.DEAs = make(map[string]*DEA)

  sub, _ := Request(c.Conn, "dea.status", nil)

  m, err := sub.NextMsg(1*time.Second)

  for err == nil {
    nDEA := &DEA{}

    json.Unmarshal(m.Data, &nDEA)
    deaMap.DEAs[nDEA.Id] = nDEA

    m, err = sub.NextMsg(1*time.Second)
  }

  sub.Unsubscribe()

  return
}

func (deaMap *DEAMap) fetchDEAStatus(c *nats.EncodedConn, id string) {
  dea := &DEA{Id: id}

  b, _ := c.Enc.Encode("dea.status", dea)
  sub, _ := Request(c.Conn, "dea.status", b)

  m, err := sub.NextMsg(1*time.Second)

  if err == nil {
    json.Unmarshal(m.Data, &dea)
    deaMap.DEAs[id] = dea
  }

  sub.Unsubscribe()

  return
}

func (deaMap *DEAMap) updateDroplets(c *nats.EncodedConn) {
  for {
/*    deaMap.dump()*/
    time.Sleep(5 * time.Second)
    for _, dea := range deaMap.DEAs {
      for _, droplet := range dea.Droplets {
        droplet_full := droplet.fetchStats(c, droplet.Version)

        if droplet_full != nil {
          droplet.Stats = droplet_full.Stats
          droplet.Dea = droplet_full.Dea
        }
      }
    }
  }
}

func (deaMap *DEAMap) dump() {

  fmt.Printf("======================= \n")

  for _, dea := range deaMap.DEAs {

    fmt.Printf("dea: -> %+v\n", dea)
    for _, droplet := range dea.Droplets {
      fmt.Printf("droplet: -> %+v\n", droplet)

    }
  }
}

func (deaMap *DEAMap) hasDEA(deaID string) bool {
  for id, _ := range deaMap.DEAs {
    if deaID == id {
      return true
    }
  }

  return false
}

func (deaMap DEAMap) d3Nodes() D3_Node {
  rootNode := D3_Node{Id: "root", NodeType: "root"}

  for _, dea := range deaMap.DEAs {
    deaNode := D3_Node{Id: dea.Id, NodeType: "dea", Parent: "root"}

    deaProperties := map[string]string {
        "ip": dea.Ip,
        "Max_memory": strconv.Itoa(dea.Max_memory),
        "Reserved_memory": strconv.Itoa(dea.Reserved_memory),
        "Used_memory": strconv.Itoa(dea.Used_memory),
        "last_seen": dea.LastSeen.Format("2006-01-02 15:04:05 -0700"),
      }

    deaNode.Properties = deaProperties

    for _, droplet := range dea.Droplets {
/*      dropletId := []string{droplet.Id, droplet.Instance}*/
      dropletNode :=  D3_Node{Id: droplet.Id, NodeType: "droplet", Parent: dea.Id}

      // set properties

      properties := map[string]string {
        "droplet": droplet.Droplet,
        "version": droplet.Version,
        "instance": droplet.Instance,
        "index": strconv.Itoa(droplet.Index),
        "state": droplet.State,
        "state_timestamp": strconv.FormatFloat(droplet.State_timestamp, 'e', -1, 64),
        "name": droplet.Stats.Name,
        "uris": strings.Join(droplet.Stats.Uris, ","),
        "host": droplet.Stats.Host,
        "port": strconv.Itoa(droplet.Stats.Port),
        "uptime": strconv.Itoa(droplet.Stats.Uptime),
        "mem_quota": strconv.Itoa(droplet.Stats.Mem_quota),
        "disk_quota": strconv.Itoa(droplet.Stats.Disk_quota),
        "fds_quota": strconv.Itoa(droplet.Stats.Fds_quota),
        "time_usage": droplet.Stats.Usage.Time,
        "cpu_usage": strconv.FormatFloat(droplet.Stats.Usage.Cpu, 'g', 1, 64),
        "mem_usage": strconv.Itoa(droplet.Stats.Usage.Mem),
        "disk_usage": strconv.Itoa(droplet.Stats.Usage.Disk),
      }

      dropletNode.Properties = properties
      deaNode.Children = append(deaNode.Children, &dropletNode)
    }
    rootNode.Children = append(rootNode.Children, &deaNode)
  }

  return rootNode
}

func (heartbeat *dea_heartbeat_msg) hasDroplet(id string) bool {
  for _, droplet := range heartbeat.Droplets {
    if droplet.Droplet + "-" + droplet.Instance == id {
      return true
    }
  }

  return false
}


func (droplet *Droplet) fetchStats(c *nats.EncodedConn, version string) (res *droplet_full) {

  droplet_req := &find_droplet_request{Droplet: droplet.Droplet, Include_stats: true, States: []string{"STARTING","RUNNING"}, Version: version}
  c.Request("dea.find.droplet", &droplet_req, &res, 1*time.Second)

  return
}


func Request(nc *nats.Conn, subj string, data []byte) (sub *nats.Subscription, err error) {

  inbox := nats.NewInbox()
  sub, _ = nc.SubscribeSync(inbox)
  err = nc.PublishRequest(subj, inbox, data)

  return
}

func (dea *DEA) getDroplet(id string) *Droplet {
  for _, droplet := range dea.Droplets {
    if droplet.Droplet + "-" + droplet.Instance == id {
      return droplet
    }
  }
  return nil
}

func main(){

  deaMap := &DEAMap{}

  var urls = flag.String("url", "nats://127.0.0.1:4222", "URL for nats server")
  var httpPort = flag.String("port", "8080", "Http port to publish html")

  flag.Parse()

  opts := nats.DefaultOptions
  opts.Servers = strings.Split(*urls, ",")

  fmt.Printf("Connecting to: %s\n", opts.Servers)
  nc, err := nats.Connect(*urls)

  if err != nil {
    log.Fatalf("Can't connect: %v\n", err)
  }

  c, _ := nats.NewEncodedConn(nc, "json")
  defer c.Close()

  deaMap.init(c)

  go func(){

    // c.Subscribe("router.register", func(m *router_register_msg) {
    //   // fmt.Printf("router.register: -> %+v\n", m)
    // })

    c.Subscribe("dea.advertise", func(m *dea_advertise_msg) {
      fmt.Printf("dea.advertise: -> %+v\n", m)

      // sync dea list
      if deaMap.hasDEA(m.Id) { //update if the dea exists
        dea := deaMap.DEAs[m.Id]
        dea.LastSeen = time.Now()
      } else { // add it to the list!
        deaMap.fetchDEAStatus(c, m.Id)
      }

    })

    c.Subscribe("dea.heartbeat", func(m *dea_heartbeat_msg) {
      fmt.Printf("dea.heartbeat: -> %+v\n", m)

      targetDEA := deaMap.DEAs[m.Dea]

      for _, droplet := range m.Droplets {

        fmt.Printf("droplet: -> %+v\n", droplet.Droplet + "-" + droplet.Instance)

        // check to see if Droplet exists on DEA
        targetDroplet := targetDEA.getDroplet(droplet.Droplet + "-" + droplet.Instance)

        // if it does, update
        if targetDroplet == nil {
          droplet.Id = droplet.Droplet + "-" + droplet.Instance
          deaMap.DEAs[m.Dea].Droplets = append(deaMap.DEAs[m.Dea].Droplets, droplet)
        } else {
          targetDroplet.State = droplet.State
          targetDroplet.State_timestamp = droplet.State_timestamp
        }
      }

      // remove droplets not in the heartbeat
      for i, droplet := range targetDEA.Droplets {
        if !m.hasDroplet(droplet.Id) {
          targetDEA.Droplets = append(targetDEA.Droplets[:i], targetDEA.Droplets[i+1:]...)
        }
      }
    })


  }()

  c.Publish("healthmanager.start", nil)
  go deaMap.updateDroplets(c)

  contentTypes := map[string]string {
    ".html": "text/html",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
  }

  http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    path := r.URL.Path
    fmt.Printf("HTTP Req: -> '%+v'\n", path)

    if path == "/" {
      path = "/index.html"
    }
    ext := filepath.Ext(path)
    staticAsset, _ := Asset("static" + path)

    if len(staticAsset) == 0 {
      w.WriteHeader(http.StatusNotFound)
    }
    w.Header().Set("Content-Type", contentTypes[ext])
    w.Write(staticAsset)
  })

  http.HandleFunc("/data.json", func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    rootNode := deaMap.d3Nodes()

    d3_json, _ := json.MarshalIndent(rootNode, "", "  ")
    fmt.Fprintf(w, string(d3_json))
  })

  log.Fatal(http.ListenAndServe(":" + *httpPort, nil))

  c.Conn.Close();
}
