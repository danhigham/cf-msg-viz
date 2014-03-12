(function(){

  var width = document.documentElement.offsetWidth,
      height = document.documentElement.offsetHeight,
      flatData = null,
      dropletColors = {},
      n = 100,
      nullSVGPath = 'M0,0 Z',
      defaultNodeStroke = '#142327',
      selectedNode = 0,
      selectorColor = "#229615",
      nextNodeInterval = null;

  var force = d3.layout.force()
      .size([width, height])
      .gravity(0.00000)
      .friction(0.4)
      .linkDistance(function(d) {
        if (d.target.type == 'dea') {
          return 120;
        } else {
          return 80;
        }
      })
      .linkStrength(function(d) {
        if ((d.source.type == 'droplet') && (d.source.type == 'droplet')) {
          return 0.5;
        } else {
          return 1;
        }
      })
      .theta(0.4)
      .charge(-2000)
      .on("tick", tick);

  var svg = d3.select("body").append("svg")
      .attr("width", width)
      .attr("height", height);

  var g = svg.append("g")

  var link = svg.selectAll(".link"),
      node = svg.selectAll(".node"),
      path = g.selectAll("path"),
      nodeText = g.selectAll("text");

  var svgDefs = svg.append("svg:defs")

  svgDefs.selectAll("marker")
    .data(["dea", "droplet", "sibling"])
  .enter().append("svg:marker")
    .attr("id", String)
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 22)
    .attr("refY", -1)
    .attr("markerWidth", 7)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
  .append("svg:path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("class", function(d) {
      return d + '-marker';
    })

  var propertyFormatters = {
    "cpu_usage": function (s) { return parseFloat(s).toFixed(4) + "%"; },
    "disk_quota": function (s) { return (parseFloat(s) / 1048576).toFixed(2) + "MB"; },
    "disk_usage": function (s) { return (parseFloat(s) / 1048576).toFixed(2) + "MB"; },
    "mem_quota": function (s) { return (parseFloat(s) / 1048576).toFixed(2) + "MB"; },
    "mem_usage": function (s) { return (parseFloat(s) / 1048576).toFixed(2) + "MB"; },
    "uptime": function (s) {
      var t = secondsToTime(parseInt(s));
      return (t.d + " days, " + t.h + " hours, " + t.m + " minutes, " + t.s + " seconds") 
    },
    "Max_memory": function (s) { return parseFloat(s).toFixed(2) + "MB"; },
    "Reserved_memory": function (s) { return parseFloat(s).toFixed(2) + "MB"; },
    "Used_memory": function (s) { return parseFloat(s).toFixed(2) + "MB"; },
    "uris": function (s) { return "<a href='http://" + s + "' target='_new'>" + s + "</a>"; }
  }

  var nodeSizes = { 'root': 2, 'dea': 15, 'droplet': 10 }
  var palette = [];

  var colors = "darkred,orange,lightyellow,lightgreen,#004499".replace(/(, *| +)/g, ',').split(',')
  colors = chroma.interpolate.bezier(colors)
  cs = chroma.scale(colors).mode('lab').correctLightness(false)

  var steps = 100;

  _ref = (function() {
    var _j, _results;

    _results = [];
    for (i = _j = 0; 0 <= steps ? _j < steps : _j > steps; i = 0 <= steps ? ++_j : --_j) {
      _results.push(i / (steps - 1));
    }
    return _results;
  })();

  for (_i = 0, _len = _ref.length; _i < _len; _i++) {
    t = _ref[_i];
    palette.push(cs(t).hex());
  }

  d3.select("body")
    .on("keyup", function() {

      var key = d3.event.keyCode;

      if (key == 65) selectPreviousNode();
      if (key == 68) selectNextNode();

      if (key == 65 || key == 68) {
        clearInterval(nextNodeInterval);
        setNextNodeInterval();
      }

    });

  function setNextNodeInterval() {
    nextNodeInterval = setInterval(function(){
      selectNextNode();
    }, 5000);
  }

  function selectNextNode() {
    selectedNode++;
    if (selectedNode > (flatData.length - 1)) selectedNode = 0;
    displayNodeData(flatData[selectedNode]);
  }

  function selectPreviousNode() {
    selectedNode--;
    if (selectedNode < 0) selectedNode = flatData.length - 1;
    displayNodeData(flatData[selectedNode]);
  }

  function displayNodeData(node) {

    if (node.type == "root") { selectNextNode(); return; }

    node.properties.node_type = node.type;

    d3.selectAll("#legend ul li").style("display", "none")

    if (!_.has(node.properties, "name")) node.properties['name'] = node.properties.ip || node.id;

    _.each(node.properties, function(v, k) {

      if (_.has(propertyFormatters, k)) v = propertyFormatters[k](v);

      var node = d3.selectAll("#" + k + "_value")
      .html(v)
      .node()

      if (node != null) node.parentNode.style.display = "block";

    });
  }

  function loadData(file) {

    fn = file == true ? file : "data.json"

    d3.json("data.json", function(json) {

      var newData = flatten(json)

      if (flatData == null) {

        flatData = newData

        var rootNode = _.find(flatData, function(n) { return n.id == 'root' });
        rootNode.fixed = true;
        rootNode.x = width / 2;
        rootNode.y = height / 2;

        displayNodeData(flatData[selectedNode]);
        setNextNodeInterval();

      } else {

        syncData(flatten(json))

      }

      force.nodes(flatData);
      var links = d3.layout.tree().links(flatData);
      addAppInstanceLinks(links);
      force.links(links);

      update();

    });
  }

  loadData();

  setInterval(function(){
    loadData();
  }, 2000)

  function syncData(newData) {

    function addOrSync(nodes) {

      _.each(nodes, function(node){

        var existing = _.findWhere(flatData, {id: node.id});

        if (existing == undefined) {

          flatData.push(node);

          if (node.parent != "") {
            var parent = _.findWhere(flatData, {id: node.parent});

            if (parent != undefined) {
              node.x = parent.x;
              node.y = parent.y;

              if (parent.children == null) parent.children = [];
              parent.children.push(node);
            }
          }
        } else {
          existing.properties = node.properties;
        }

        addOrSync(node.children);
      });
    }

    //remove nodes from flatdata that don't exist in newDoc
    _.each(flatData, function(node) {

      var toKeep = _.findWhere(newData, {id: node.id});

      if (toKeep == undefined) {

        if (node.parent != "") {
          var parent = _.findWhere(flatData, {id: node.parent});
          parent.children = _.without(parent.children, _.findWhere(parent.children, {id: node.id}));
        }

        flatData = _.without(flatData, _.findWhere(flatData, {id: node.id}));
      }
    });

    addOrSync(newData);

  }

  function addAppInstanceLinks(links) {
    var droplets = _.where(flatData, {type: 'droplet'});
    var inARelationship = [];

    _.each(droplets, function(droplet) {

      var dropletID = droplet.properties.droplet;
      var version = droplet.properties.version;
      var instance = droplet.properties.instance;

      _.each(_.filter(droplets, function(sibling) { return ((sibling.properties.droplet == dropletID) && (sibling.properties.version == version) && (sibling.properties.instance != instance) && (_.findWhere(inARelationship, {id: sibling.id}) == undefined)) }), function (sibling) {
        inARelationship.push(sibling);
        links.push({source: droplet, target: sibling});
      });
    });
  }

  function update() {

    // Update the nodes…
    node = node.data(force.nodes(), function(d) { return d.id; });

    // Exit any old nodes.
    node.exit().remove();

    // Enter any new nodes.
    var g = node.enter().append("g")


    // memory usage ring
    g.append("path")
      .attr("class", "nodeChart")
      .attr("fill", "#f00")

    // selection ring
    g.append("path")
      .attr("class", "selector")
      .attr("d", function(d){

        return d3.svg.arc()
          .innerRadius(d.type == 'droplet' ? nodeSizes[d.type] + 4 : 0)
          .outerRadius(d.type == 'droplet' ? nodeSizes[d.type] + 8 : nodeSizes[d.type] + 4)
          .startAngle(0)
          .endAngle(6.28)();

      })

    g.append("circle")
      .attr("r", function(d) { return nodeSizes[d.type]; })
      .attr("class", function(d) { return "node " + d.type; })
      .attr("fill", function(d) {
        return d.type == 'droplet' ? getColorForDroplet(d) : null;
      })
      .attr("stroke", function(d) {
        return d.type == 'droplet' ? chroma(getColorForDroplet(d)).darken().hex() : null;
      })
      .on("click", function(d){
        var i = _.indexOf(flatData, d);
        if (i > -1) selectedNode = i;

        displayNodeData(d);
        clearInterval(nextNodeInterval);
        setNextNodeInterval();
      })

    nodeText = nodeText.data(force.nodes(), function(d) { return d.id; });
    nodeText.exit().remove();
    nodeText.enter().append("text")
    .attr("x", 20)
    .attr("y", ".31em")

    path = path.data(force.links(), function(d) { return d.source.id + "-" + d.target.id; });

    path.exit().remove();

    path.enter().insert("path")
      .attr("d", linkPath)
      .attr("stroke", function(d) {
        return ((d.source.type == "droplet") && (d.target.type == "droplet")) ? chroma(getColorForDroplet(d)).darken().hex() : null;
      })
      .attr("class", function(d) {
        if(d.source.type == "root") return 'link';
        if((d.source.type == "dea") && (d.target.type == "droplet")) return 'curved-link'
        if((d.source.type == "droplet") && (d.target.type == "droplet")) return 'sibling'
      })
      .attr("marker-end", function(d) {
        return ((d.source.type == "droplet") && (d.target.type == "droplet")) ? null : "url(#" + d.source.type + ")";
      })



    force.start()
    // for (var i = n * n; i > 0; --i) force.tick();
    // force.stop();
  }

  function tick() {

    path.attr("d", linkPath)

    node.selectAll("path.selector")
      .attr("fill", function(d) { return d == force.nodes()[selectedNode] ? selectorColor : 'rgba(0,0,0,0)' })

    node
      .attr("transform", transform)
      .selectAll("path.nodeChart")
      .attr("d", function(d){
        if (d.type != 'droplet') return nullSVGPath;
        if (d.properties == undefined) return nullSVGPath;

        var node = d;

        return d3.svg.arc()
          .innerRadius(0)
          .outerRadius(nodeSizes['droplet'] + 4)
          .startAngle(0)
          .endAngle(function(d, i){
            return(Math.ceil(360 * parseFloat(node.properties.mem_usage)/parseFloat(node.properties.mem_quota)) * (Math.PI/180));
          })();
      })

    nodeText.attr("transform", transform)
      .text(function(d) {

        if (d.properties != null)
        {
          if (d.type == 'droplet') return d.properties.name;
          if (d.type == 'dea') return d.properties.ip;
        }
      });
  }

  function getColorForDroplet(d) {
    var droplet = d.source || d;

    var dropletVersion = droplet.properties.droplet + "-" + droplet.properties.version;
    if (dropletColors[dropletVersion] == null) dropletColors[dropletVersion] = palette[_.random(0,100)];
    return dropletColors[dropletVersion]
  }

  function linkPath(d) {
    var path = nullSVGPath;

    if ((d.source.x && d.source.y && d.target.x && d.target.y) == undefined) return nullSVGPath;

    if ((d.source.type == "root") && (d.target != undefined)) path = ("M" + d.source.x + "," + d.source.y + "L" + d.target.x + "," + d.target.y);
    else if ((d.source != undefined) && (d.target != undefined)) {

      var dx = d.target.x - d.source.x,
          dy = d.target.y - d.source.y,
          dr = Math.sqrt(dx * dx + dy * dy);

      path = "M" + d.source.x + "," + d.source.y + "A" + dr + "," + dr + " 0 0,1 " + d.target.x + "," + d.target.y;
    }
    return path;
  }

  function transform(d) {
    return "translate(" + d.x + "," + d.y + ")";
  }

  function secondsToTime(inputSeconds) {

    var secondsInAMinute = 60;
    var secondsInAnHour  = 60 * secondsInAMinute;
    var secondsInADay    = 24 * secondsInAnHour;

    // extract days
    var days = Math.floor(inputSeconds / secondsInADay);

    // extract hours
    var hourSeconds = inputSeconds % secondsInADay;
    var hours = Math.floor(hourSeconds / secondsInAnHour);

    // extract minutes
    var minuteSeconds = hourSeconds % secondsInAnHour;
    var minutes = Math.floor(minuteSeconds / secondsInAMinute);

    // extract the remaining seconds
    var remainingSeconds = minuteSeconds % secondsInAMinute;
    var seconds = Math.ceil(remainingSeconds);

    // return the final array
    var obj = {
        'd' : parseInt(days),
        'h' : parseInt(hours),
        'm' : parseInt(minutes),
        's' : parseInt(seconds)
    };
    return obj;
  }

  // Returns a list of all nodes under the root.
  function flatten(root) {
    var nodes = [];

    function recurse(node) {
      if (node.children) node.children.forEach(recurse);
      nodes.push(node);
    }

    recurse(root);
    return nodes;
  }
})();
